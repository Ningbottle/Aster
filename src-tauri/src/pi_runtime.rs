//! Single live Pi process bound to one project and native session.

use crate::pi_connector::{PiLaunchOptions, PiRuntime, PiSession, SessionEvent};
use crate::pi_sessions::project_paths_equal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub type PiEventSink = Arc<dyn Fn(u64, SessionEvent) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct PiActiveBinding {
    pub instance_id: u64,
    pub project_path: PathBuf,
    pub session_id: String,
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

trait PiProcess: Send {
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
    fn stop(&mut self) -> std::io::Result<()>;
    fn is_closed(&self) -> bool;
}

impl PiProcess for PiSession {
    fn get_state(&self) -> Result<Value, String> {
        PiSession::get_state(self)
    }
    fn get_messages(&self) -> Result<Vec<Value>, String> {
        PiSession::get_messages(self)
    }
    fn get_session_stats(&self) -> Result<Value, String> {
        PiSession::get_session_stats(self)
    }
    fn switch_session(&self, session_path: &Path) -> Result<bool, String> {
        PiSession::switch_session(self, session_path)
    }
    fn new_session(&self) -> Result<(), String> {
        PiSession::new_session(self)
    }
    fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String> {
        PiSession::set_model(self, provider, model_id)
    }
    fn set_thinking_level(&self, level: &str) -> Result<(), String> {
        PiSession::set_thinking_level(self, level)
    }
    fn set_session_name(&self, name: &str) -> Result<(), String> {
        PiSession::set_session_name(self, name)
    }
    fn get_available_models(&self) -> Result<Vec<Value>, String> {
        PiSession::get_available_models(self)
    }
    fn prompt(&self, message: &str) -> Result<(), String> {
        PiSession::prompt(self, message)
    }
    fn abort(&self) -> Result<(), String> {
        PiSession::abort(self)
    }
    fn wait_settled(&self, timeout: Duration) -> bool {
        PiSession::wait_settled(self, timeout)
    }
    fn stop(&mut self) -> std::io::Result<()> {
        PiSession::stop(self)
    }
    fn is_closed(&self) -> bool {
        PiSession::is_closed(self)
    }
}

struct StartSpec {
    cli_js: PathBuf,
    cwd: PathBuf,
    options: PiLaunchOptions,
    instance_id: u64,
    on_event: PiEventSink,
}

type ProcessStarter = Arc<dyn Fn(StartSpec) -> Result<Box<dyn PiProcess>, String> + Send + Sync>;

struct ActivePiRuntime {
    instance_id: u64,
    project_path: PathBuf,
    session_id: String,
    session_path: Option<PathBuf>,
    session: Box<dyn PiProcess>,
}

pub struct PiRuntimeManager {
    next_instance_id: AtomicU64,
    active: Mutex<Option<ActivePiRuntime>>,
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

    pub fn session_id_if_instance(&self, instance_id: u64) -> Option<String> {
        let guard = self.active.lock().ok()?;
        let active = guard.as_ref()?;
        if active.instance_id == instance_id {
            Some(active.session_id.clone())
        } else {
            None
        }
    }

    pub fn create_session(
        &self,
        runtime: &PiRuntime,
        project_path: &Path,
        on_event: PiEventSink,
    ) -> Result<PiActiveSnapshot, PiOpenError> {
        if !project_path.is_dir() {
            return Err(PiOpenError::ProjectMissing);
        }
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
        if !project_path.is_dir() {
            return Err(PiOpenError::ProjectMissing);
        }
        if !session_path.is_file() {
            return Err(PiOpenError::SessionMissing);
        }
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
        self.with_live(|session, _| session.prompt(message))
    }

    pub fn abort(&self) -> Result<PiActiveSnapshot, String> {
        self.with_live(|session, _| {
            session.abort()?;
            let _ = session.wait_settled(Duration::from_secs(30));
            Ok(())
        })?;
        self.snapshot()
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self
            .active
            .lock()
            .map_err(|e| format!("runtime lock failed: {e}"))?;
        if let Some(mut active) = guard.take() {
            let _ = active.session.stop();
        }
        Ok(())
    }

    pub fn set_model(&self, provider: &str, model_id: &str) -> Result<PiActiveSnapshot, String> {
        self.with_live(|session, _| session.set_model(provider, model_id).map(|_| ()))?;
        self.snapshot()
    }

    pub fn set_thinking_level(&self, level: &str) -> Result<PiActiveSnapshot, String> {
        self.with_live(|session, _| session.set_thinking_level(level))?;
        self.snapshot()
    }

    pub fn set_session_name(&self, name: &str) -> Result<PiActiveSnapshot, String> {
        self.with_live(|session, _| session.set_session_name(name))?;
        self.snapshot()
    }

    pub fn get_available_models(&self) -> Result<Vec<Value>, String> {
        self.with_live(|session, _| session.get_available_models())
    }

    pub fn get_state(&self) -> Result<Value, String> {
        self.with_live(|session, _| session.get_state())
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

    fn with_live<T>(
        &self,
        f: impl FnOnce(&dyn PiProcess, &ActivePiRuntime) -> Result<T, String>,
    ) -> Result<T, String> {
        let guard = self
            .active
            .lock()
            .map_err(|e| format!("runtime lock failed: {e}"))?;
        let active = guard.as_ref().ok_or("no active Pi session")?;
        if active.session.is_closed() {
            return Err("no active Pi session".into());
        }
        f(active.session.as_ref(), active)
    }

    fn same_project_idle(&self, project_path: &Path) -> Result<bool, PiOpenError> {
        let mut guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let Some(active) = guard.as_mut() else {
            return Ok(false);
        };
        if active.session.is_closed() {
            *guard = None;
            return Ok(false);
        }
        if !project_paths_equal(&active.project_path, project_path) {
            self.ensure_not_busy(active.session.as_ref())?;
            return Ok(false);
        }
        self.ensure_not_busy(active.session.as_ref())?;
        Ok(true)
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
        let mut guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let active = guard
            .as_mut()
            .ok_or(PiOpenError::RpcFailed("no active Pi session".into()))?;
        self.ensure_not_busy(active.session.as_ref())?;
        active
            .session
            .new_session()
            .map_err(PiOpenError::RpcFailed)?;
        refresh_active(active)
    }

    fn switch_on_active(&self, session_path: &Path) -> Result<PiActiveSnapshot, PiOpenError> {
        let mut guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let active = guard
            .as_mut()
            .ok_or(PiOpenError::RpcFailed("no active Pi session".into()))?;
        self.ensure_not_busy(active.session.as_ref())?;
        let cancelled = active
            .session
            .switch_session(session_path)
            .map_err(PiOpenError::RpcFailed)?;
        if cancelled {
            return Err(PiOpenError::Cancelled);
        }
        active.session_path = Some(session_path.to_path_buf());
        refresh_active(active)
    }

    fn restart(
        &self,
        runtime: &PiRuntime,
        project_path: &Path,
        session_path: Option<PathBuf>,
        on_event: PiEventSink,
    ) -> Result<PiActiveSnapshot, PiOpenError> {
        {
            let mut guard = self
                .active
                .lock()
                .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
            if let Some(active) = guard.as_ref() {
                if !active.session.is_closed() {
                    self.ensure_not_busy(active.session.as_ref())?;
                }
            }
            if let Some(mut old) = guard.take() {
                let _ = old.session.stop();
            }
        }

        let instance_id = self.next_instance_id.fetch_add(1, Ordering::SeqCst);
        let spec = StartSpec {
            cli_js: PathBuf::from(&runtime.cli_js),
            cwd: project_path.to_path_buf(),
            options: PiLaunchOptions {
                session_path: session_path.clone(),
            },
            instance_id,
            on_event,
        };
        let session = match (self.starter)(spec) {
            Ok(s) => s,
            Err(e) => return Err(PiOpenError::StartFailed(e)),
        };
        let mut active = ActivePiRuntime {
            instance_id,
            project_path: project_path.to_path_buf(),
            session_id: String::new(),
            session_path,
            session,
        };
        let snap = match refresh_active(&mut active) {
            Ok(s) => s,
            Err(e) => {
                let _ = active.session.stop();
                return Err(e);
            }
        };
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
        let mut guard = self
            .active
            .lock()
            .map_err(|e| PiOpenError::RpcFailed(format!("runtime lock failed: {e}")))?;
        let active = guard
            .as_mut()
            .ok_or(PiOpenError::RpcFailed("no active Pi session".into()))?;
        if active.session.is_closed() {
            *guard = None;
            return Err(PiOpenError::RpcFailed("no active Pi session".into()));
        }
        refresh_active(active)
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

fn refresh_active(active: &mut ActivePiRuntime) -> Result<PiActiveSnapshot, PiOpenError> {
    let state = active.session.get_state().map_err(PiOpenError::RpcFailed)?;
    let messages = active
        .session
        .get_messages()
        .map_err(PiOpenError::RpcFailed)?;
    let stats = active.session.get_session_stats().unwrap_or(Value::Null);
    if let Some(id) = state.get("sessionId").and_then(Value::as_str) {
        if !id.is_empty() {
            active.session_id = id.to_string();
        }
    }
    if let Some(file) = state.get("sessionFile").and_then(Value::as_str) {
        if !file.is_empty() {
            active.session_path = Some(PathBuf::from(file));
        }
    }
    Ok(PiActiveSnapshot {
        binding: binding_of(active),
        state,
        messages,
        stats,
    })
}

fn start_real_process(spec: StartSpec) -> Result<Box<dyn PiProcess>, String> {
    let sink = spec.on_event;
    let instance_id = spec.instance_id;
    let session = PiSession::start(&spec.cli_js, &spec.cwd, None, &spec.options, move |event| {
        sink(instance_id, event)
    })
    .map_err(|e| e.to_string())?;
    Ok(Box::new(session))
}

/// Scriptable backend used by binding tests. Not a second Pi integration route.
pub struct FakePiController {
    pub starts: Mutex<Vec<(PathBuf, Option<PathBuf>)>>,
    pub switches: Mutex<Vec<PathBuf>>,
    pub stops: AtomicU64,
    pub aborts: AtomicU64,
    pub new_sessions: AtomicU64,
    pub streaming: std::sync::atomic::AtomicBool,
    pub compacting: std::sync::atomic::AtomicBool,
    pub fail_next_start: std::sync::atomic::AtomicBool,
    pub session_id: Mutex<String>,
    pub messages: Mutex<Vec<Value>>,
}

impl FakePiController {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            starts: Mutex::new(Vec::new()),
            switches: Mutex::new(Vec::new()),
            stops: AtomicU64::new(0),
            aborts: AtomicU64::new(0),
            new_sessions: AtomicU64::new(0),
            streaming: std::sync::atomic::AtomicBool::new(false),
            compacting: std::sync::atomic::AtomicBool::new(false),
            fail_next_start: std::sync::atomic::AtomicBool::new(false),
            session_id: Mutex::new(String::new()),
            messages: Mutex::new(Vec::new()),
        })
    }
}

struct FakePiProcess {
    ctrl: Arc<FakePiController>,
    session_path: Mutex<Option<PathBuf>>,
    closed: std::sync::atomic::AtomicBool,
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
            Ok(Box::new(FakePiProcess {
                ctrl: Arc::clone(&script),
                session_path: Mutex::new(spec.options.session_path),
                closed: std::sync::atomic::AtomicBool::new(false),
            }))
        }))
    }
}

impl PiProcess for FakePiProcess {
    fn get_state(&self) -> Result<Value, String> {
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
    fn stop(&mut self) -> std::io::Result<()> {
        self.closed.store(true, Ordering::SeqCst);
        self.ctrl.stops.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }
}
