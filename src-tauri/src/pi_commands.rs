//! Typed Pi project/session Tauri commands. DTOs never include native session files.

use crate::db::{self, PiSessionIndexRecord};
use crate::pi_runtime::{PiActiveSnapshot, PiEventEnvelope, PiOpenError, PiRuntimeManager};
use crate::pi_sessions::{
    default_session_root, normalize_project_path, project_paths_equal, relative_locator,
    resolve_session_path, scan_session_root, PiSessionCatalogEntry,
};
use crate::{locked_runtime, open_layout_and_db, pi_event_sink};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::State;

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

pub type PiEventEnvelopeDto = PiEventEnvelope;

#[tauri::command]
pub fn pi_project_tree_refresh(
    state: State<PiRuntimeManager>,
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
        };
        db::upsert_pi_session(&conn, &rec).map_err(|e| e.to_string())?;
        seen.push(entry.session_id);
    }
    db::mark_pi_sessions_unseen(&conn, &seen).map_err(|e| e.to_string())?;

    for rec in db::list_pi_session_index(&conn).map_err(|e| e.to_string())? {
        if rec.availability == "available" && !Path::new(&rec.project_path).is_dir() {
            db::mark_pi_session_project_missing(&conn, &rec.session_id)
                .map_err(|e| e.to_string())?;
        }
    }

    build_tree(&conn, state.active_binding())
}

#[tauri::command]
pub fn pi_session_create(
    app: tauri::AppHandle,
    state: State<PiRuntimeManager>,
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
pub fn pi_session_open(
    app: tauri::AppHandle,
    state: State<PiRuntimeManager>,
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
pub fn pi_session_snapshot(state: State<PiRuntimeManager>) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.snapshot()?)
}

#[tauri::command]
pub fn pi_session_set_name(
    state: State<PiRuntimeManager>,
    name: String,
) -> Result<PiActiveSessionDto, String> {
    let snap = state.set_session_name(&name)?;
    persist_snapshot(&snap)?;
    dto_from_snapshot(&snap)
}

#[tauri::command]
pub fn pi_session_set_model(
    state: State<PiRuntimeManager>,
    provider: String,
    model_id: String,
) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.set_model(&provider, &model_id)?)
}

#[tauri::command]
pub fn pi_session_set_thinking_level(
    state: State<PiRuntimeManager>,
    level: String,
) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.set_thinking_level(&level)?)
}

#[tauri::command]
pub fn pi_session_prompt(state: State<PiRuntimeManager>, message: String) -> Result<(), String> {
    state.prompt(&message)
}

#[tauri::command]
pub fn pi_session_abort(state: State<PiRuntimeManager>) -> Result<PiActiveSessionDto, String> {
    dto_from_snapshot(&state.abort()?)
}

#[tauri::command]
pub fn pi_session_stop(state: State<PiRuntimeManager>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub fn pi_session_index_remove(
    state: State<PiRuntimeManager>,
    session_id: String,
) -> Result<Vec<PiProjectNodeDto>, String> {
    let (_layout, conn) = open_layout_and_db()?;
    db::remove_pi_session_index(&conn, session_id.trim()).map_err(|e| e.to_string())?;
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
    let indexed = db::list_pi_session_index(conn).map_err(|e| e.to_string())?;
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
