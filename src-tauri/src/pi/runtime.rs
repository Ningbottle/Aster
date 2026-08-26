//! Single live Pi process bound to one project and native session.

use crate::pi_connector::{PiLaunchOptions, PiRuntime, PiSession, SessionEvent};
use crate::pi_sessions::project_paths_equal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

pub type PiEventSink = Arc<dyn Fn(u64, Option<String>, SessionEvent) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct PiActiveBinding {
    pub instance_id: u64,
    pub project_path: PathBuf,
    pub session_id: String,
}

/// Whether a global Project mutation may proceed while a Pi session is bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivateProjectDecision {
    Proceed,
    Noop,
}

pub fn project_binding_display(binding: &PiActiveBinding) -> String {
    binding
        .project_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "当前项目".into())
}

pub fn active_session_blocks_project_change(binding: &PiActiveBinding) -> String {
    let display = project_binding_display(binding);
    format!(
        "当前存在活动 Pi Session，绑定项目为「{display}」。已保留该 Session。如需切换或清除项目，请先在 Pi 中停止 Session，再重新操作。"
    )
}

/// Activate another global project. Same path as the live binding is a no-op.
pub fn decide_activate_project(
    binding: Option<&PiActiveBinding>,
    next: &Path,
) -> Result<ActivateProjectDecision, String> {
    match binding {
        None => Ok(ActivateProjectDecision::Proceed),
        Some(b) if project_paths_equal(&b.project_path, next) => Ok(ActivateProjectDecision::Noop),
        Some(b) => Err(active_session_blocks_project_change(b)),
    }
}

/// Setting or clearing Pi host_workdir while a slot is occupied would silently
/// change `pi::workspace()` without touching the live session cwd.
pub fn decide_set_pi_host_workdir(binding: Option<&PiActiveBinding>) -> Result<(), String> {
    match binding {
        Some(b) => Err(active_session_blocks_project_change(b)),
        None => Ok(()),
    }
}

/// Removing the bound project from recents / clearing it is refused.
pub fn decide_remove_project(
    binding: Option<&PiActiveBinding>,
    removing: &Path,
) -> Result<(), String> {
    match binding {
        Some(b) if project_paths_equal(&b.project_path, removing) => {
            Err(active_session_blocks_project_change(b))
        }
        _ => Ok(()),
    }
}

/// 归档/取消归档某 session。活动/占用槽位的 session 拒绝归档（与 M0 守卫同语义），
/// 未占用时允许（含取消归档）。
pub fn decide_archive_session(
    binding: Option<&PiActiveBinding>,
    session_id: &str,
) -> Result<(), String> {
    match binding {
        Some(b) if b.session_id == session_id => Err(active_session_blocks_project_change(b)),
        _ => Ok(()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeSnapshotDto {
    pub lifecycle: String,
    pub has_locked_install: bool,
    pub project_path: Option<String>,
    pub session_id: Option<String>,
    pub runtime_instance_id: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct PiActiveSnapshot {
    pub binding: PiActiveBinding,
    pub state: Value,
    pub messages: Vec<Value>,
    pub stats: Value,
}

#[derive(Debug)]
pub enum PiOpenError {
    Busy,
    ProjectMissing,
    SessionMissing,
    StartFailed(String),
    RpcFailed(String),
    Cancelled,
}

impl std::fmt::Display for PiOpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PiOpenError::Busy => write!(f, "busy"),
            PiOpenError::ProjectMissing => write!(f, "project directory is missing"),
            PiOpenError::SessionMissing => write!(f, "session file is missing"),
            PiOpenError::StartFailed(msg) | PiOpenError::RpcFailed(msg) => write!(f, "{msg}"),
            PiOpenError::Cancelled => write!(f, "session switch was cancelled"),
        }
    }
}

impl From<PiOpenError> for String {
    fn from(value: PiOpenError) -> Self {
        value.to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiEventEnvelope {
    pub runtime_instance_id: u64,
    pub session_id: Option<String>,
    pub event_type: String,
    pub summary: String,
    pub raw: Value,
}

trait PiProcess: Send + Sync {
    fn get_state(&self) -> Result<Value, String>;
    fn get_messages(&self) -> Result<Vec<Value>, String>;
    fn get_session_stats(&self) -> Result<Value, String>;
    fn switch_session(&self, session_path: &Path) -> Result<bool, String>;
    fn new_session(&self) -> Result<(), String>;
    fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String>;
    fn set_thinking_level(&self, level: &str) -> Result<(), String>;
    fn set_session_name(&self, name: &str) -> Result<(), String>;
    fn get_available_models(&self) -> Result<Vec<Value>, String>;
    fn prompt(&self, message: &str) -> Result<(), String>;
    fn abort(&self) -> Result<(), String>;
    fn wait_settled(&self, timeout: Duration) -> bool;
    fn stop(&self) -> std::io::Result<()>;
    fn is_closed(&self) -> bool;
}

struct LockedPiSession {
    inner: Mutex<PiSession>,
}

impl PiProcess for LockedPiSession {
    fn get_state(&self) -> Result<Value, String> {
        lock_session(&self.inner)?.get_state()
    }
    fn get_messages(&self) -> Result<Vec<Value>, String> {
        lock_session(&self.inner)?.get_messages()
    }
    fn get_session_stats(&self) -> Result<Value, String> {
        lock_session(&self.inner)?.get_session_stats()
    }
    fn switch_session(&self, session_path: &Path) -> Result<bool, String> {
        lock_session(&self.inner)?.switch_session(session_path)
    }
    fn new_session(&self) -> Result<(), String> {
        lock_session(&self.inner)?.new_session()
    }
    fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String> {
        lock_session(&self.inner)?.set_model(provider, model_id)
    }
    fn set_thinking_level(&self, level: &str) -> Result<(), String> {
        lock_session(&self.inner)?.set_thinking_level(level)
    }
    fn set_session_name(&self, name: &str) -> Result<(), String> {
        lock_session(&self.inner)?.set_session_name(name)
    }
    fn get_available_models(&self) -> Result<Vec<Value>, String> {
        lock_session(&self.inner)?.get_available_models()
    }
    fn prompt(&self, message: &str) -> Result<(), String> {
        lock_session(&self.inner)?.prompt(message)
    }
    fn abort(&self) -> Result<(), String> {
        lock_session(&self.inner)?.abort()
    }
    fn wait_settled(&self, timeout: Duration) -> bool {
        let watcher = match self.inner.lock() {
            Ok(session) => session.watcher(),
            Err(_) => return false,
        };
        watcher.wait_settled(timeout)
    }
    fn stop(&self) -> std::io::Result<()> {
        // 审计关注点：restart() 会在持有 active 锁时调用这里，从而形成
        // active -> inner 的锁序。这里记录 inner 的实际等待时长。
        crate::diag::lock_wait("pi.session.inner(stop)", &self.inner)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "session lock poisoned"))?
            .stop()
    }
    fn is_closed(&self) -> bool {
        self.inner.lock().map(|s| s.is_closed()).unwrap_or(true)
    }
}

fn lock_session(inner: &Mutex<PiSession>) -> Result<std::sync::MutexGuard<'_, PiSession>, String> {
    crate::diag::lock_wait("pi.session.inner", inner)
        .map_err(|e| format!("session lock failed: {e}"))
}

struct StartSpec {
    cli_js: PathBuf,
    cwd: PathBuf,
    options: PiLaunchOptions,
    on_event: Arc<dyn Fn(SessionEvent) + Send + Sync>,
}

type ProcessStarter = Arc<dyn Fn(StartSpec) -> Result<Arc<dyn PiProcess>, String> + Send + Sync>;

struct ActivePiRuntime {
    instance_id: u64,
    project_path: PathBuf,
    session_id: String,
    session_path: Option<PathBuf>,
    session: Arc<dyn PiProcess>,
    published_session_id: Arc<Mutex<String>>,
    last_busy: bool,
}

pub struct PiRuntimeManager {
    next_instance_id: AtomicU64,
    active: Mutex<Option<ActivePiRuntime>>,
    start_gate: Mutex<()>,
    starter: ProcessStarter,
}

impl Default for PiRuntimeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PiRuntimeManager {
    pub fn new() -> Self {
        Self::with_starter(Arc::new(start_real_process))
    }

    fn with_starter(starter: ProcessStarter) -> Self {
        Self {
            next_instance_id: AtomicU64::new(1),
            active: Mutex::new(None),
            start_gate: Mutex::new(()),
            starter,
        }
    }

    pub fn active_binding(&self) -> Option<PiActiveBinding> {
        let guard = self.active.lock().ok()?;
        let active = guard.as_ref()?;
        if active.session.is_closed() {
            return None;
        }
        Some(binding_of(active))
    }

    /// Occupied slot binding, including a crashed process until `stop()` clears it.
    pub fn bound_binding(&self) -> Option<PiActiveBinding> {
        let guard = self.active.lock().ok()?;
        Some(binding_of(guard.as_ref()?))
    }

    pub fn runtime_snapshot(&self, has_locked_install: bool) -> PiRuntimeSnapshotDto {
        let guard = match self.active.lock() {
            Ok(g) => g,
            Err(_) => {
                return PiRuntimeSnapshotDto {
                    lifecycle: "unknown".into(),
                    has_locked_install,
                    project_path: None,
                    session_id: None,
                    runtime_instance_id: None,
                };
            }
        };
        match guard.as_ref() {
            None => PiRuntimeSnapshotDto {
                lifecycle: if has_locked_install {
                    "closed".into()
                } else {
                    "needsSetup".into()
                },
                has_locked_install,
                project_path: None,
                session_id: None,
                runtime_instance_id: None,
            },
            Some(active) if active.session.is_closed() => PiRuntimeSnapshotDto {
                lifecycle: "crashed".into(),
                has_locked_install,
                project_path: Some(active.project_path.to_string_lossy().into_owned()),
                session_id: Some(active.session_id.clone()),
                runtime_instance_id: Some(active.instance_id),
            },
            Some(active) => PiRuntimeSnapshotDto {
                lifecycle: if active.last_busy {
                    "busy".into()
                } else {
                    "ready".into()
                },
                has_locked_install,
                project_path: Some(active.project_path.to_string_lossy().into_owned()),
                session_id: Some(active.session_id.clone()),
                runtime_instance_id: Some(active.instance_id),
            },
        }
    }

    pub fn create_session(
        &self,
        runtime: &PiRuntime,
        project_path: &Path,
        on_event: PiEventSink,
    ) -> Result<PiActiveSnapshot, PiOpenError> {
        let _gate = self
            .start_gate
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("start lock failed: {e}")))?;
        if !project_path.is_dir() {
            return Err(PiOpenError::ProjectMissing);
        }
        self.refuse_other_project_if_crashed(project_path)?;
        if self.same_project_idle(project_path)? {
            return self.new_session_on_active();
        }
        self.restart(runtime, project_path, None, on_event)
    }

    pub fn open_session(
        &self,
        runtime: &PiRuntime,
        project_path: &Path,
        session_path: &Path,
        on_event: PiEventSink,
    ) -> Result<PiActiveSnapshot, PiOpenError> {
        let _gate = self
            .start_gate
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("start lock failed: {e}")))?;
        if !project_path.is_dir() {
            return Err(PiOpenError::ProjectMissing);
        }
        if !session_path.is_file() {
            return Err(PiOpenError::SessionMissing);
        }
        self.refuse_other_project_if_crashed(project_path)?;
        if self.is_already_open(project_path, session_path)? {
            return self.snapshot_active();
        }
        if self.same_project_idle(project_path)? {
            return self.switch_on_active(session_path);
        }
        self.restart(
            runtime,
            project_path,
            Some(session_path.to_path_buf()),
            on_event,
        )
    }

    pub fn snapshot(&self) -> Result<PiActiveSnapshot, String> {
        self.snapshot_active().map_err(|e| e.to_string())
    }

    pub fn prompt(&self, message: &str) -> Result<(), String> {
        self.live_session()?.prompt(message)
    }

    pub fn abort(&self) -> Result<PiActiveSnapshot, String> {
        let session = self.live_session()?;
        session.abort()?;
        let _ = session.wait_settled(Duration::from_secs(30));
        self.snapshot()
    }

    pub fn stop(&self) -> Result<(), String> {
        let (instance_id, session, already_closed) = {
            let guard = crate::diag::lock_wait("pi.runtime.active(stop)", &self.active)
                .map_err(|e| format!("runtime lock failed: {e}"))?;
            match guard.as_ref() {
                None => return Ok(()),
                Some(active) => (
                    active.instance_id,
                    Arc::clone(&active.session),
                    active.session.is_closed(),
                ),
            }
        };
        // Process already gone: releasing the slot is the remaining work. Do not
        // call kill and pretend a timeout is a failed stop of a live child.
        if !already_closed {
            session
                .stop()
                .map_err(|e| format!("未能停止 Pi Session: {e}"))?;
        }
        let mut guard = crate::diag::lock_wait("pi.runtime.active(stop.clear)", &self.active)
            .map_err(|e| format!("runtime lock failed: {e}"))?;
        if guard.as_ref().map(|a| a.instance_id) == Some(instance_id) {
            *guard = None;
        }
        Ok(())
    }

    /// 退出路径：拿不到锁就跳过，避免进程退不出。
    pub fn try_stop(&self) -> Result<(), String> {
        let old = match self.active.try_lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => return Err("try_lock failed".into()),
        };
        if let Some(old) = old {
            let _ = old.session.stop();
        }
        Ok(())
    }

    pub fn set_model(&self, provider: &str, model_id: &str) -> Result<PiActiveSnapshot, String> {
        self.live_session()?
            .set_model(provider, model_id)
            .map(|_| ())?;
        self.snapshot()
    }

    pub fn set_thinking_level(&self, level: &str) -> Result<PiActiveSnapshot, String> {
        self.live_session()?.set_thinking_level(level)?;
        self.snapshot()
    }

    pub fn set_session_name(&self, name: &str) -> Result<PiActiveSnapshot, String> {
        self.live_session()?.set_session_name(name)?;
        self.snapshot()
    }

    pub fn get_available_models(&self) -> Result<Vec<Value>, String> {
        self.live_session()?.get_available_models()
    }

    pub fn get_state(&self) -> Result<Value, String> {
        self.live_session()?.get_state()
    }

    pub fn observation_json(&self) -> Result<Value, String> {
        match self.active_binding() {
            Some(binding) => Ok(json!({
                "active": true,
                "closed": false,
                "instanceId": binding.instance_id,
                "sessionId": binding.session_id,
            })),
            None => Ok(json!({ "active": false, "closed": true })),
        }
    }

    fn live_session(&self) -> Result<Arc<dyn PiProcess>, String> {
        let guard = self
            .active
            .lock()
            .map_err(|e| format!("runtime lock failed: {e}"))?;
        let active = guard.as_ref().ok_or("no active Pi session")?;
        if active.session.is_closed() {
            return Err("no active Pi session".into());
        }
        Ok(Arc::clone(&active.session))
    }

    /// A crashed slot still binds its project. Opening/creating on another
    /// project would take the slot via restart and silently drop M0 protection.
    fn refuse_other_project_if_crashed(&self, project_path: &Path) -> Result<(), PiOpenError> {
        let guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let Some(active) = guard.as_ref() else {
            return Ok(());
        };
        if !active.session.is_closed() {
            return Ok(());
        }
        if project_paths_equal(&active.project_path, project_path) {
            return Ok(());
        }
        Err(PiOpenError::RpcFailed(active_session_blocks_project_change(
            &binding_of(active),
        )))
    }

    fn same_project_idle(&self, project_path: &Path) -> Result<bool, PiOpenError> {
        let session = {
            let guard = self
                .active
                .lock()
                .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
            let Some(active) = guard.as_ref() else {
                return Ok(false);
            };
            if active.session.is_closed() {
                // Occupied crashed slot must stay until stop() or same-project restart.
                return Ok(false);
            }
            let same = project_paths_equal(&active.project_path, project_path);
            (Arc::clone(&active.session), same)
        };
        self.ensure_not_busy(session.0.as_ref())?;
        Ok(session.1)
    }

    fn is_already_open(
        &self,
        project_path: &Path,
        session_path: &Path,
    ) -> Result<bool, PiOpenError> {
        let guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let Some(active) = guard.as_ref() else {
            return Ok(false);
        };
        if active.session.is_closed() {
            return Ok(false);
        }
        if !project_paths_equal(&active.project_path, project_path) {
            return Ok(false);
        }
        Ok(active
            .session_path
            .as_ref()
            .is_some_and(|p| project_paths_equal(p, session_path)))
    }

    fn ensure_not_busy(&self, session: &dyn PiProcess) -> Result<(), PiOpenError> {
        let state = session.get_state().map_err(PiOpenError::RpcFailed)?;
        if state_busy(&state) {
            return Err(PiOpenError::Busy);
        }
        Ok(())
    }

    fn new_session_on_active(&self) -> Result<PiActiveSnapshot, PiOpenError> {
        let session = self.live_session().map_err(PiOpenError::RpcFailed)?;
        self.ensure_not_busy(session.as_ref())?;
        session.new_session().map_err(PiOpenError::RpcFailed)?;
        {
            let mut guard = self
                .active
                .lock()
                .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
            if let Some(active) = guard.as_mut() {
                active.session_path = None;
                if let Ok(mut published) = active.published_session_id.lock() {
                    published.clear();
                }
            }
        }
        self.snapshot_active()
    }

    fn switch_on_active(&self, session_path: &Path) -> Result<PiActiveSnapshot, PiOpenError> {
        let session = self.live_session().map_err(PiOpenError::RpcFailed)?;
        self.ensure_not_busy(session.as_ref())?;
        let cancelled = session
            .switch_session(session_path)
            .map_err(PiOpenError::RpcFailed)?;
        if cancelled {
            return Err(PiOpenError::Cancelled);
        }
        {
            let mut guard = self
                .active
                .lock()
                .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
            if let Some(active) = guard.as_mut() {
                active.session_path = Some(session_path.to_path_buf());
            }
        }
        self.snapshot_active()
    }

    fn restart(
        &self,
        runtime: &PiRuntime,
        project_path: &Path,
        session_path: Option<PathBuf>,
        on_event: PiEventSink,
    ) -> Result<PiActiveSnapshot, PiOpenError> {
        {
            let session = {
                let guard = self
                    .active
                    .lock()
                    .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
                guard.as_ref().and_then(|active| {
                    if active.session.is_closed() {
                        None
                    } else {
                        Some(Arc::clone(&active.session))
                    }
                })
            };
            if let Some(session) = session {
                self.ensure_not_busy(session.as_ref())?;
            }
            let old = {
                let mut guard = crate::diag::lock_wait("pi.runtime.active(restart)", &self.active)
                    .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
                guard.take()
            };
            if let Some(old) = old {
                let _span = crate::diag::span("shutdown", "restart_stop_old_session");
                let _ = old.session.stop();
            }
        }

        let instance_id = self.next_instance_id.fetch_add(1, Ordering::SeqCst);
        let published_session_id = Arc::new(Mutex::new(String::new()));
        let stamped = wrap_event_sink(instance_id, Arc::clone(&published_session_id), on_event);
        let spec = StartSpec {
            cli_js: PathBuf::from(&runtime.cli_js),
            cwd: project_path.to_path_buf(),
            options: PiLaunchOptions {
                session_path: session_path.clone(),
            },
            on_event: stamped,
        };
        let session = match (self.starter)(spec) {
            Ok(s) => s,
            Err(e) => return Err(PiOpenError::StartFailed(e)),
        };
        let fetched = match fetch_snapshot(session.as_ref()) {
            Ok(s) => s,
            Err(e) => {
                let _ = session.stop();
                return Err(e);
            }
        };
        let active = ActivePiRuntime {
            instance_id,
            project_path: project_path.to_path_buf(),
            session_id: fetched.session_id.clone(),
            session_path: fetched.session_path.clone().or(session_path),
            session,
            published_session_id,
            last_busy: state_busy(&fetched.state),
        };
        publish_session_id(&active.published_session_id, &active.session_id);
        let snap = snapshot_from(&active, fetched);
        match self.active.lock() {
            Ok(mut guard) => {
                *guard = Some(active);
                Ok(snap)
            }
            Err(e) => {
                let _ = active.session.stop();
                Err(PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))
            }
        }
    }

    fn snapshot_active(&self) -> Result<PiActiveSnapshot, PiOpenError> {
        let (instance_id, session) = {
            let guard = self
                .active
                .lock()
                .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
            let active = guard
                .as_ref()
                .ok_or(PiOpenError::RpcFailed("no active Pi session".into()))?;
            if active.session.is_closed() {
                return Err(PiOpenError::RpcFailed("no active Pi session".into()));
            }
            (active.instance_id, Arc::clone(&active.session))
        };
        let fetched = fetch_snapshot(session.as_ref())?;
        let mut guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let active = guard
            .as_mut()
            .ok_or(PiOpenError::RpcFailed("no active Pi session".into()))?;
        if active.instance_id != instance_id {
            return Err(PiOpenError::RpcFailed("no active Pi session".into()));
        }
        apply_fetched(active, &fetched);
        Ok(snapshot_from(active, fetched))
    }
}

fn wrap_event_sink(
    instance_id: u64,
    published: Arc<Mutex<String>>,
    user: PiEventSink,
) -> Arc<dyn Fn(SessionEvent) + Send + Sync> {
    Arc::new(move |event| {
        let session_id = published.lock().ok().and_then(|id| {
            if id.is_empty() {
                None
            } else {
                Some(id.clone())
            }
        });
        user(instance_id, session_id, event);
    })
}

fn publish_session_id(published: &Mutex<String>, session_id: &str) {
    if let Ok(mut slot) = published.lock() {
        *slot = session_id.to_string();
    }
}

fn binding_of(active: &ActivePiRuntime) -> PiActiveBinding {
    PiActiveBinding {
        instance_id: active.instance_id,
        project_path: active.project_path.clone(),
        session_id: active.session_id.clone(),
    }
}

fn state_busy(state: &Value) -> bool {
    state
        .get("isStreaming")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || state
            .get("isCompacting")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

struct FetchedSnapshot {
    state: Value,
    messages: Vec<Value>,
    stats: Value,
    session_id: String,
    session_path: Option<PathBuf>,
}

fn fetch_snapshot(session: &dyn PiProcess) -> Result<FetchedSnapshot, PiOpenError> {
    let state = session.get_state().map_err(PiOpenError::RpcFailed)?;
    let messages = session.get_messages().map_err(PiOpenError::RpcFailed)?;
    let stats = session.get_session_stats().unwrap_or(Value::Null);
    let session_id = state
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let session_path = state
        .get("sessionFile")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    Ok(FetchedSnapshot {
        state,
        messages,
        stats,
        session_id,
        session_path,
    })
}

fn apply_fetched(active: &mut ActivePiRuntime, fetched: &FetchedSnapshot) {
    if !fetched.session_id.is_empty() {
        active.session_id = fetched.session_id.clone();
        publish_session_id(&active.published_session_id, &active.session_id);
    }
    active.session_path = fetched.session_path.clone();
    active.last_busy = state_busy(&fetched.state);
}

fn snapshot_from(active: &ActivePiRuntime, fetched: FetchedSnapshot) -> PiActiveSnapshot {
    PiActiveSnapshot {
        binding: binding_of(active),
        state: fetched.state,
        messages: fetched.messages,
        stats: fetched.stats,
    }
}

fn start_real_process(spec: StartSpec) -> Result<Arc<dyn PiProcess>, String> {
    let on_event = spec.on_event;
    let session = PiSession::start(&spec.cli_js, &spec.cwd, None, &spec.options, move |event| {
        on_event(event);
    })
    .map_err(|e| e.to_string())?;
    Ok(Arc::new(LockedPiSession {
        inner: Mutex::new(session),
    }))
}

pub struct FakePiController {
    pub starts: Mutex<Vec<(PathBuf, Option<PathBuf>)>>,
    pub switches: Mutex<Vec<PathBuf>>,
    pub stops: AtomicU64,
    pub aborts: AtomicU64,
    pub new_sessions: AtomicU64,
    pub streaming: AtomicBool,
    pub compacting: AtomicBool,
    pub fail_next_start: AtomicBool,
    pub force_closed: AtomicBool,
    pub fail_next_stop: AtomicBool,
    pub session_id: Mutex<String>,
    pub messages: Mutex<Vec<Value>>,
    block_get_state: AtomicBool,
    entered_get_state: Mutex<bool>,
    get_state_cv: Condvar,
}

impl FakePiController {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            starts: Mutex::new(Vec::new()),
            switches: Mutex::new(Vec::new()),
            stops: AtomicU64::new(0),
            aborts: AtomicU64::new(0),
            new_sessions: AtomicU64::new(0),
            streaming: AtomicBool::new(false),
            compacting: AtomicBool::new(false),
            fail_next_start: AtomicBool::new(false),
            force_closed: AtomicBool::new(false),
            fail_next_stop: AtomicBool::new(false),
            session_id: Mutex::new(String::new()),
            messages: Mutex::new(Vec::new()),
            block_get_state: AtomicBool::new(false),
            entered_get_state: Mutex::new(false),
            get_state_cv: Condvar::new(),
        })
    }

    pub fn block_next_get_state(&self) {
        if let Ok(mut entered) = self.entered_get_state.lock() {
            *entered = false;
        }
        self.block_get_state.store(true, Ordering::SeqCst);
    }

    pub fn wait_until_get_state_entered(&self) {
        let mut entered = self.entered_get_state.lock().unwrap();
        while !*entered {
            entered = self.get_state_cv.wait(entered).unwrap();
        }
    }

    pub fn release_get_state(&self) {
        self.block_get_state.store(false, Ordering::SeqCst);
        self.get_state_cv.notify_all();
    }
}

struct FakePiProcess {
    ctrl: Arc<FakePiController>,
    session_path: Mutex<Option<PathBuf>>,
    closed: AtomicBool,
}

impl PiRuntimeManager {
    pub fn with_fake(ctrl: Arc<FakePiController>) -> Self {
        let script = Arc::clone(&ctrl);
        Self::with_starter(Arc::new(move |spec| {
            if script.fail_next_start.swap(false, Ordering::SeqCst) {
                return Err("fake start failed".into());
            }
            script
                .starts
                .lock()
                .unwrap()
                .push((spec.cwd, spec.options.session_path.clone()));
            if let Some(path) = &spec.options.session_path {
                if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                    *script.session_id.lock().unwrap() = id.to_string();
                }
            } else if script.session_id.lock().unwrap().is_empty() {
                *script.session_id.lock().unwrap() = "created-1".into();
            }
            Ok(Arc::new(FakePiProcess {
                ctrl: Arc::clone(&script),
                session_path: Mutex::new(spec.options.session_path),
                closed: AtomicBool::new(false),
            }) as Arc<dyn PiProcess>)
        }))
    }
}

impl PiProcess for FakePiProcess {
    fn get_state(&self) -> Result<Value, String> {
        if self.ctrl.block_get_state.load(Ordering::SeqCst) {
            {
                let mut entered = self.ctrl.entered_get_state.lock().unwrap();
                *entered = true;
                self.ctrl.get_state_cv.notify_all();
                while self.ctrl.block_get_state.load(Ordering::SeqCst) {
                    entered = self.ctrl.get_state_cv.wait(entered).unwrap();
                }
            }
        }
        let id = self.ctrl.session_id.lock().unwrap().clone();
        let file = self
            .session_path
            .lock()
            .unwrap()
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        Ok(json!({
            "sessionId": id,
            "sessionFile": file,
            "isStreaming": self.ctrl.streaming.load(Ordering::SeqCst),
            "isCompacting": self.ctrl.compacting.load(Ordering::SeqCst),
            "thinkingLevel": "medium",
            "model": {"id": "fixture-model", "name": "Fixture Model", "provider": "fixture"},
            "messageCount": self.ctrl.messages.lock().unwrap().len(),
        }))
    }
    fn get_messages(&self) -> Result<Vec<Value>, String> {
        Ok(self.ctrl.messages.lock().unwrap().clone())
    }
    fn get_session_stats(&self) -> Result<Value, String> {
        Ok(json!({"contextUsage": {"percent": 2}}))
    }
    fn switch_session(&self, session_path: &Path) -> Result<bool, String> {
        self.ctrl
            .switches
            .lock()
            .unwrap()
            .push(session_path.to_path_buf());
        if let Some(id) = session_path.file_stem().and_then(|s| s.to_str()) {
            *self.ctrl.session_id.lock().unwrap() = id.to_string();
        }
        *self.session_path.lock().unwrap() = Some(session_path.to_path_buf());
        Ok(false)
    }
    fn new_session(&self) -> Result<(), String> {
        let n = self.ctrl.new_sessions.fetch_add(1, Ordering::SeqCst) + 1;
        *self.ctrl.session_id.lock().unwrap() = format!("created-{n}");
        *self.session_path.lock().unwrap() = None;
        Ok(())
    }
    fn set_model(&self, _provider: &str, _model_id: &str) -> Result<Value, String> {
        Ok(Value::Null)
    }
    fn set_thinking_level(&self, _level: &str) -> Result<(), String> {
        Ok(())
    }
    fn set_session_name(&self, _name: &str) -> Result<(), String> {
        Ok(())
    }
    fn get_available_models(&self) -> Result<Vec<Value>, String> {
        Ok(vec![
            json!({"id":"fixture-model","name":"Fixture Model","provider":"fixture"}),
        ])
    }
    fn prompt(&self, _message: &str) -> Result<(), String> {
        Ok(())
    }
    fn abort(&self) -> Result<(), String> {
        self.ctrl.aborts.fetch_add(1, Ordering::SeqCst);
        self.ctrl.streaming.store(false, Ordering::SeqCst);
        self.ctrl.compacting.store(false, Ordering::SeqCst);
        Ok(())
    }
    fn wait_settled(&self, _timeout: Duration) -> bool {
        true
    }
    fn stop(&self) -> std::io::Result<()> {
        if self.ctrl.fail_next_stop.swap(false, Ordering::SeqCst) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Pi process still alive after taskkill /T /F",
            ));
        }
        self.closed.store(true, Ordering::SeqCst);
        self.ctrl.stops.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn is_closed(&self) -> bool {
        // Latch onto this process so a later replacement process can be live.
        if self.ctrl.force_closed.load(Ordering::SeqCst) {
            self.closed.store(true, Ordering::SeqCst);
        }
        self.closed.load(Ordering::SeqCst)
    }
}
