//! Typed Pi project/session Tauri commands. DTOs never include native session files.
#![allow(clippy::unused_async)] // blocking bodies; async only to leave the Win32 UI thread

use crate::db::{self, PiSessionIndexRecord};
use crate::ipc::diag;
use crate::pi::connector::{self as pi_connector, PiRuntime, SessionEvent};
use crate::pi::locked_runtime;
use crate::pi_runtime::{
    PiActiveSnapshot, PiEventEnvelope, PiEventSink, PiOpenError, PiRuntimeManager,
    PiRuntimeSnapshotDto,
};
use crate::pi_sessions::{
    default_session_root, normalize_project_path, project_paths_equal, relative_locator,
    resolve_session_path, scan_session_root, PiSessionCatalogEntry,
};
use crate::platform::{app_data, open_layout_and_db};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State};

pub const PERMISSION_SUMMARY: &str = "windows_user";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionSummaryDto {
    pub session_id: String,
    pub name: Option<String>,
    pub created_at: String,
    pub modified_at: String,
    pub message_count: u64,
    pub availability: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiProjectNodeDto {
    pub path: String,
    pub display_name: String,
    pub sessions: Vec<PiSessionSummaryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiActiveSessionDto {
    pub runtime_instance_id: u64,
    pub project_path: String,
    pub project_display_name: String,
    pub session_id: String,
    pub session_name: Option<String>,
    pub model: Option<Value>,
    pub thinking_level: String,
    pub is_streaming: bool,
    pub is_compacting: bool,
    pub message_count: u64,
    pub context_usage: Option<Value>,
    pub permission_summary: String,
    pub messages: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionCreateArgs {
    pub project_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionOpenArgs {
    pub project_path: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionSetNameArgs {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionSetModelArgs {
    pub provider: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionSetThinkingArgs {
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionPromptArgs {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionIndexRemoveArgs {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionArchiveArgs {
    pub session_id: String,
    pub archived: bool,
}

pub type PiEventEnvelopeDto = PiEventEnvelope;

#[tauri::command]
pub async fn pi_project_tree_refresh(
    state: State<'_, PiRuntimeManager>,
) -> Result<Vec<PiProjectNodeDto>, String> {
    let (_layout, conn) = open_layout_and_db()?;
    let root = default_session_root().map_err(|e| e.to_string())?;
    let catalog = scan_session_root(&root).map_err(|e| e.to_string())?;
    let mut recent = db::list_recent_projects(&conn).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut seen = Vec::new();

    for entry in catalog {
        let project_path = bind_catalog_project(&conn, &mut recent, &entry)?;
        let availability = if Path::new(&project_path).is_dir() {
            "available"
        } else {
            "project_missing"
        };
        let rec = PiSessionIndexRecord {
            session_id: entry.session_id.clone(),
            project_path,
            session_rel_path: entry.rel_path.to_string_lossy().replace('/', "\\"),
            session_name: entry.session_name.clone(),
            created_at: entry.created_at.clone(),
            modified_at: entry.modified_at.clone(),
            message_count: entry.message_count as i64,
            availability: availability.into(),
            last_seen_at: now.clone(),
            archived: false, // 重新扫描不重置用户归档状态：upsert 不覆盖 archived
        };
        db::upsert_pi_session(&conn, &rec).map_err(|e| e.to_string())?;
        seen.push(entry.session_id);
    }
    db::mark_pi_sessions_unseen(&conn, &seen).map_err(|e| e.to_string())?;

    for rec in db::list_pi_session_index_visible(&conn).map_err(|e| e.to_string())? {
        if rec.availability == "available" && !Path::new(&rec.project_path).is_dir() {
            db::mark_pi_session_project_missing(&conn, &rec.session_id)
                .map_err(|e| e.to_string())?;
        }
    }

    build_tree(&conn, state.active_binding())
}

#[tauri::command]
pub async fn pi_session_create(
    app: tauri::AppHandle,
    state: State<'_, PiRuntimeManager>,
    project_path: String,
) -> Result<PiActiveSessionDto, String> {
    let runtime = locked_runtime()?;
    let path = PathBuf::from(project_path.trim());
    let snap = state
        .create_session(&runtime, &path, pi_event_sink(app))
        .map_err(open_err)?;
    persist_snapshot(&snap)?;
    dto_from_snapshot(&snap)
}

#[tauri::command]
pub async fn pi_session_open(
    app: tauri::AppHandle,
    state: State<'_, PiRuntimeManager>,
    project_path: String,
    session_id: String,
) -> Result<PiActiveSessionDto, String> {
    let (_layout, conn) = open_layout_and_db()?;
    let rec = db::get_pi_session(&conn, &session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "session is not in the Aster index".to_string())?;
    if !project_paths_equal(Path::new(&rec.project_path), Path::new(project_path.trim())) {
        return Err("session does not belong to the requested project".into());
    }
    if rec.availability != "available" {
        return Err(format!("session is {}", rec.availability));
    }
    let root = default_session_root().map_err(|e| e.to_string())?;
    let session_file = match resolve_session_path(&root, &rec.session_rel_path) {
        Ok(path) => path,
        Err(_) => {
            db::mark_pi_session_missing(&conn, &session_id).map_err(|e| e.to_string())?;
            return Err("session file is missing".into());
        }
    };
    let runtime = locked_runtime()?;
    let snap = state
        .open_session(
            &runtime,
            Path::new(project_path.trim()),
            &session_file,
            pi_event_sink(app),
        )
        .map_err(|err| {
            if matches!(err, PiOpenError::SessionMissing) {
                let _ = db::mark_pi_session_missing(&conn, &session_id);
            }
            open_err(err)
        })?;
    persist_snapshot(&snap)?;
    dto_from_snapshot(&snap)
}

#[tauri::command]
pub async fn pi_session_snapshot(
    state: State<'_, PiRuntimeManager>,
) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.snapshot()?)
}

#[tauri::command]
pub async fn pi_session_set_name(
    state: State<'_, PiRuntimeManager>,
    name: String,
) -> Result<PiActiveSessionDto, String> {
    let snap = state.set_session_name(&name)?;
    persist_snapshot(&snap)?;
    dto_from_snapshot(&snap)
}

#[tauri::command]
pub async fn pi_session_set_model(
    state: State<'_, PiRuntimeManager>,
    provider: String,
    model_id: String,
) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.set_model(&provider, &model_id)?)
}

#[tauri::command]
pub async fn pi_session_set_thinking_level(
    state: State<'_, PiRuntimeManager>,
    level: String,
) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.set_thinking_level(&level)?)
}

#[tauri::command]
pub async fn pi_session_prompt(
    state: State<'_, PiRuntimeManager>,
    message: String,
) -> Result<(), String> {
    state.prompt(&message)
}

#[tauri::command]
pub async fn pi_session_abort(
    state: State<'_, PiRuntimeManager>,
) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.abort()?)
}

#[tauri::command]
pub async fn pi_session_stop(state: State<'_, PiRuntimeManager>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub async fn pi_runtime_snapshot(
    state: State<'_, PiRuntimeManager>,
) -> Result<PiRuntimeSnapshotDto, String> {
    let has_locked_install = locked_runtime().is_ok();
    Ok(state.runtime_snapshot(has_locked_install))
}

#[tauri::command]
pub async fn pi_session_index_remove(
    state: State<'_, PiRuntimeManager>,
    session_id: String,
) -> Result<Vec<PiProjectNodeDto>, String> {
    let (_layout, conn) = open_layout_and_db()?;
    db::remove_pi_session_index(&conn, session_id.trim()).map_err(|e| e.to_string())?;
    build_tree(&conn, state.active_binding())
}

#[tauri::command]
pub async fn pi_session_archive(
    state: State<'_, PiRuntimeManager>,
    session_id: String,
    archived: bool,
) -> Result<Vec<PiProjectNodeDto>, String> {
    let session_id = session_id.trim();
    // 活动/占用槽位的 session 不可归档：先停止 Session 再归档（与 M0 守卫同语义）。
    crate::pi::runtime::decide_archive_session(state.bound_binding().as_ref(), session_id)
        .map_err(|e| e.to_string())?;
    let (_layout, conn) = open_layout_and_db()?;
    db::set_pi_session_archived(&conn, session_id, archived).map_err(|e| e.to_string())?;
    build_tree(&conn, state.active_binding())
}

fn open_err(err: PiOpenError) -> String {
    err.to_string()
}

fn bind_catalog_project(
    conn: &rusqlite::Connection,
    recent: &mut Vec<db::RecentProjectRecord>,
    entry: &PiSessionCatalogEntry,
) -> Result<String, String> {
    for rec in recent.iter() {
        if project_paths_equal(Path::new(&rec.path), &entry.cwd) {
            return Ok(rec.path.clone());
        }
    }
    let identity = normalize_project_path(&entry.cwd);
    if Path::new(&identity).is_dir() {
        let display = display_name_for(&identity);
        db::record_recent_project(conn, &identity, &display).map_err(|e| e.to_string())?;
        recent.push(db::RecentProjectRecord {
            path: identity.clone(),
            display_name: display,
            last_opened_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    Ok(identity)
}

fn build_tree(
    conn: &rusqlite::Connection,
    active: Option<crate::pi_runtime::PiActiveBinding>,
) -> Result<Vec<PiProjectNodeDto>, String> {
    let recent = db::list_recent_projects(conn).map_err(|e| e.to_string())?;
    let indexed = db::list_pi_session_index_visible(conn).map_err(|e| e.to_string())?;
    let mut groups: BTreeMap<String, PiProjectNodeDto> = BTreeMap::new();

    for rec in recent {
        groups.entry(rec.path.clone()).or_insert(PiProjectNodeDto {
            path: rec.path.clone(),
            display_name: rec.display_name,
            sessions: Vec::new(),
        });
    }
    for rec in indexed {
        let node = groups
            .entry(rec.project_path.clone())
            .or_insert_with(|| PiProjectNodeDto {
                path: rec.project_path.clone(),
                display_name: display_name_for(&rec.project_path),
                sessions: Vec::new(),
            });
        let is_active = active.as_ref().is_some_and(|b| {
            b.session_id == rec.session_id
                && project_paths_equal(&b.project_path, Path::new(&rec.project_path))
        });
        node.sessions.push(PiSessionSummaryDto {
            session_id: rec.session_id,
            name: rec.session_name,
            created_at: rec.created_at,
            modified_at: rec.modified_at,
            message_count: rec.message_count.max(0) as u64,
            availability: rec.availability,
            is_active,
        });
    }
    let mut out: Vec<PiProjectNodeDto> = groups.into_values().collect();
    for node in &mut out {
        node.sessions
            .sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    }
    out.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(out)
}

fn persist_snapshot(snap: &PiActiveSnapshot) -> Result<(), String> {
    let (_layout, conn) = open_layout_and_db()?;
    let project = normalize_project_path(&snap.binding.project_path);
    if Path::new(&project).is_dir() {
        db::record_recent_project(&conn, &project, &display_name_for(&project))
            .map_err(|e| e.to_string())?;
        db::set_active_project(&conn, &project).map_err(|e| e.to_string())?;
    }
    let root = default_session_root().map_err(|e| e.to_string())?;
    let Some(rel) = snap
        .state
        .get("sessionFile")
        .and_then(Value::as_str)
        .and_then(|file| relative_locator(&root, Path::new(file)).ok())
    else {
        return Ok(());
    };
    let now = chrono::Utc::now().to_rfc3339();
    let rec = PiSessionIndexRecord {
        session_id: snap.binding.session_id.clone(),
        project_path: project,
        session_rel_path: rel,
        session_name: snap
            .state
            .get("sessionName")
            .and_then(Value::as_str)
            .map(str::to_string),
        created_at: now.clone(),
        modified_at: now.clone(),
        message_count: snap
            .state
            .get("messageCount")
            .and_then(Value::as_u64)
            .unwrap_or(snap.messages.len() as u64) as i64,
        availability: "available".into(),
        last_seen_at: now,
        archived: false,
    };
    db::upsert_pi_session(&conn, &rec).map_err(|e| e.to_string())
}

fn dto_from_snapshot(snap: &PiActiveSnapshot) -> Result<PiActiveSessionDto, String> {
    let project_path = snap.binding.project_path.to_string_lossy().into_owned();
    Ok(PiActiveSessionDto {
        runtime_instance_id: snap.binding.instance_id,
        project_display_name: display_name_for(&project_path),
        project_path,
        session_id: snap.binding.session_id.clone(),
        session_name: snap
            .state
            .get("sessionName")
            .and_then(Value::as_str)
            .map(str::to_string),
        model: snap.state.get("model").cloned().filter(|v| !v.is_null()),
        thinking_level: snap
            .state
            .get("thinkingLevel")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        is_streaming: snap
            .state
            .get("isStreaming")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        is_compacting: snap
            .state
            .get("isCompacting")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        message_count: snap
            .state
            .get("messageCount")
            .and_then(Value::as_u64)
            .unwrap_or(snap.messages.len() as u64),
        context_usage: snap.stats.get("contextUsage").cloned(),
        permission_summary: PERMISSION_SUMMARY.into(),
        messages: snap.messages.clone(),
    })
}

fn display_name_for(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path.to_string())
}

#[tauri::command]
pub async fn pi_discover() -> Result<Vec<PiRuntime>, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = pi_connector::discover(&root);
    if let Ok((_layout, conn)) = crate::platform::open_layout_and_db() {
        for r in &runtimes {
            let kind = if r.managed {
                "managed"
            } else {
                "recognized_external"
            };
            let _ = db::record_host_install(&conn, "pi", kind, &r.version, &r.cli_js);
        }
    }
    Ok(runtimes)
}

#[tauri::command]
pub async fn pi_install_managed(version: Option<String>) -> Result<PiRuntime, String> {
    let ver = version
        .as_deref()
        .unwrap_or(pi_connector::LOCKED_PI_VERSION);
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtime = pi_connector::install_managed(&root, ver)?;
    if let Ok((_layout, conn)) = crate::platform::open_layout_and_db() {
        let _ = db::record_host_install(&conn, "pi", "managed", &runtime.version, &runtime.cli_js);
    }
    Ok(runtime)
}
const DELTA_FLUSH: Duration = Duration::from_millis(16);

struct PendingDelta {
    instance_id: u64,
    session_id: Option<String>,
    event: SessionEvent,
}

fn is_text_delta(event: &SessionEvent) -> bool {
    event.event_type == "message_update"
        && event
            .raw
            .get("assistantMessageEvent")
            .and_then(|e| e.get("type"))
            .and_then(|t| t.as_str())
            == Some("text_delta")
}

fn merge_text_delta(dst: &mut SessionEvent, src: SessionEvent) {
    let extra = src
        .raw
        .get("assistantMessageEvent")
        .and_then(|e| e.get("delta"))
        .and_then(|d| d.as_str())
        .unwrap_or("")
        .to_string();
    if let Some(delta) = dst
        .raw
        .get_mut("assistantMessageEvent")
        .and_then(|e| e.as_object_mut())
        .and_then(|e| e.get_mut("delta"))
    {
        if let Some(existing) = delta.as_str() {
            *delta = Value::String(format!("{existing}{extra}"));
        }
    }
    dst.summary = src.summary;
}

fn emit_pi_event(
    app: &tauri::AppHandle,
    instance_id: u64,
    session_id: Option<String>,
    event: SessionEvent,
) {
    diag::emit_tick();
    let _ = app.emit(
        "pi-event",
        PiEventEnvelope {
            runtime_instance_id: instance_id,
            session_id,
            event_type: event.event_type,
            summary: event.summary,
            raw: event.raw,
        },
    );
}

pub(crate) fn pi_event_sink(app: tauri::AppHandle) -> PiEventSink {
    let pending: Arc<Mutex<Option<PendingDelta>>> = Arc::new(Mutex::new(None));
    let last_flush = Arc::new(Mutex::new(Instant::now() - DELTA_FLUSH));
    Arc::new(move |instance_id, session_id, event: SessionEvent| {
        if is_text_delta(&event) {
            let mut slot = match pending.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if let Some(p) = slot.as_mut() {
                merge_text_delta(&mut p.event, event);
            } else {
                *slot = Some(PendingDelta {
                    instance_id,
                    session_id,
                    event,
                });
            }
            let due = last_flush
                .lock()
                .map(|t| t.elapsed() >= DELTA_FLUSH)
                .unwrap_or(true);
            if due {
                if let Some(p) = slot.take() {
                    if let Ok(mut t) = last_flush.lock() {
                        *t = Instant::now();
                    }
                    drop(slot);
                    emit_pi_event(&app, p.instance_id, p.session_id, p.event);
                }
            }
            return;
        }
        if let Ok(mut slot) = pending.lock() {
            if let Some(p) = slot.take() {
                emit_pi_event(&app, p.instance_id, p.session_id, p.event);
                if let Ok(mut t) = last_flush.lock() {
                    *t = Instant::now();
                }
            }
        }
        emit_pi_event(&app, instance_id, session_id, event);
    })
}

#[tauri::command]
pub fn pi_session_status(state: tauri::State<PiRuntimeManager>) -> Result<bool, String> {
    Ok(state.active_binding().is_some())
}

#[tauri::command]
pub async fn pi_get_available_models(
    state: tauri::State<'_, PiRuntimeManager>,
) -> Result<Vec<serde_json::Value>, String> {
    state.get_available_models()
}

#[tauri::command]
pub async fn pi_set_model(
    state: tauri::State<'_, PiRuntimeManager>,
    provider: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    let snap = state.set_model(&provider, &model_id)?;
    Ok(snap.state)
}

#[tauri::command]
pub async fn pi_get_state(
    state: tauri::State<'_, PiRuntimeManager>,
) -> Result<serde_json::Value, String> {
    state.get_state()
}

#[tauri::command]
pub fn pi_session_observation(
    state: tauri::State<PiRuntimeManager>,
) -> Result<serde_json::Value, String> {
    state.observation_json()
}

#[cfg(test)]
mod delta_tests {
    use super::*;
    use serde_json::json;

    fn delta_event(text: &str) -> SessionEvent {
        SessionEvent {
            event_type: "message_update".into(),
            summary: format!("text: {text}"),
            raw: json!({
                "assistantMessageEvent": { "type": "text_delta", "delta": text }
            }),
        }
    }

    #[test]
    fn merge_text_delta_concatenates() {
        let mut a = delta_event("hel");
        merge_text_delta(&mut a, delta_event("lo"));
        assert_eq!(
            a.raw["assistantMessageEvent"]["delta"].as_str(),
            Some("hello")
        );
        assert!(is_text_delta(&a));
    }
}
