pub mod app_data;
pub mod credentials;
pub mod db;
pub mod diag;
pub mod dsh_connector;
pub mod evidence;
pub mod host_profile;
pub mod logging;
pub mod pi_commands;
pub mod pi_connector;
pub mod pi_runtime;
pub mod pi_sessions;
pub mod skill_flow;
pub mod supervisor;

use dsh_connector::{DshRuntime, DshServer, DshStatus};
use pi_connector::{PiRuntime, SessionEvent};
use pi_runtime::{
    decide_activate_project, decide_remove_project, ActivateProjectDecision, PiEventEnvelope,
    PiEventSink, PiRuntimeManager,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct AppStatus {
    app_version: String,
    app_data_dir: String,
    database_schema_version: u32,
    evidence_count: i64,
}

/// 共享状态：单个活跃 DSH Web 服务实例（M2 纵切）。
struct DshSlot {
    server: Mutex<Option<DshServer>>,
}

#[tauri::command]
fn get_app_status() -> Result<AppStatus, String> {
    let layout = app_data::AppDataLayout::open_default().map_err(|e| e.to_string())?;
    let db_path = layout.database.join("aster.db");
    let mut conn = db::open_connection(&db_path).map_err(|e| e.to_string())?;
    let schema_version = db::migrate(&mut conn).map_err(|e| e.to_string())?;
    let evidence_count = evidence::count(&conn).map_err(|e| e.to_string())?;

    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        app_data_dir: layout.root.display().to_string(),
        database_schema_version: schema_version,
        evidence_count,
    })
}

pub(crate) fn open_layout_and_db() -> Result<(app_data::AppDataLayout, rusqlite::Connection), String>
{
    let layout = app_data::AppDataLayout::open_default().map_err(|e| e.to_string())?;
    let mut conn =
        db::open_connection(&layout.database.join("aster.db")).map_err(|e| e.to_string())?;
    db::migrate(&mut conn).map_err(|e| e.to_string())?;
    Ok((layout, conn))
}

#[tauri::command]
fn pi_discover() -> Result<Vec<PiRuntime>, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = pi_connector::discover(&root);
    if let Ok((_layout, conn)) = open_layout_and_db() {
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
fn pi_install_managed(version: Option<String>) -> Result<PiRuntime, String> {
    let ver = version
        .as_deref()
        .unwrap_or(pi_connector::LOCKED_PI_VERSION);
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtime = pi_connector::install_managed(&root, ver)?;
    if let Ok((_layout, conn)) = open_layout_and_db() {
        let _ = db::record_host_install(&conn, "pi", "managed", &runtime.version, &runtime.cli_js);
    }
    Ok(runtime)
}

/// Pi 会话使用的工作目录：
/// 1. 优先使用宿主专属覆盖 host_workdir('pi')；
/// 2. 其次使用全局活动项目 active_project；
/// 3. 最后回退到 sessions/pi-workspace。
fn pi_workspace(layout: &app_data::AppDataLayout, conn: Option<&rusqlite::Connection>) -> PathBuf {
    if let Some(conn) = conn {
        if let Ok(Some(hw)) = db::get_host_workdir(conn, "pi") {
            let p = PathBuf::from(&hw);
            if p.is_dir() {
                return p;
            }
        }
        if let Ok(Some(ap)) = db::get_active_project(conn) {
            let p = PathBuf::from(&ap);
            if p.is_dir() {
                return p;
            }
        }
    }
    let dir = layout.sessions.join("pi-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub(crate) fn locked_runtime() -> Result<PiRuntime, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = pi_connector::discover(&root);
    if let Some(managed) = runtimes
        .iter()
        .find(|r| r.managed && r.version == pi_connector::LOCKED_PI_VERSION)
    {
        return Ok(managed.clone());
    }
    if let Some(external) = runtimes
        .iter()
        .find(|r| !r.managed && r.version == pi_connector::LOCKED_PI_VERSION)
    {
        return Ok(external.clone());
    }
    Err(format!(
        "Pi {} not found (checked Aster-managed under runtimes/pi/{} and external npm)",
        pi_connector::LOCKED_PI_VERSION,
        pi_connector::LOCKED_PI_VERSION
    ))
}

pub(crate) fn pi_event_sink(app: tauri::AppHandle) -> PiEventSink {
    Arc::new(move |instance_id, session_id, event: SessionEvent| {
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
    })
}

#[tauri::command]
fn pi_session_status(state: tauri::State<PiRuntimeManager>) -> Result<bool, String> {
    Ok(state.active_binding().is_some())
}

#[tauri::command]
fn pi_get_available_models(
    state: tauri::State<PiRuntimeManager>,
) -> Result<Vec<serde_json::Value>, String> {
    state.get_available_models()
}

#[tauri::command]
fn pi_set_model(
    state: tauri::State<PiRuntimeManager>,
    provider: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    let snap = state.set_model(&provider, &model_id)?;
    Ok(snap.state)
}

#[tauri::command]
fn pi_get_state(state: tauri::State<PiRuntimeManager>) -> Result<serde_json::Value, String> {
    state.get_state()
}

#[tauri::command]
fn pi_session_observation(
    state: tauri::State<PiRuntimeManager>,
) -> Result<serde_json::Value, String> {
    state.observation_json()
}

#[tauri::command]
fn skill_status() -> Result<serde_json::Value, String> {
    let (layout, conn) = open_layout_and_db()?;
    let mut snapshots = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at FROM skill_snapshot ORDER BY created_at DESC, id DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "source_repo": row.get::<_, String>(1)?,
                    "commit_sha": row.get::<_, String>(2)?,
                    "skill_name": row.get::<_, String>(3)?,
                    "file_count": row.get::<_, i64>(4)?,
                    "content_sha": row.get::<_, String>(5)?,
                    "created_at": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            snapshots.push(r);
        }
    }
    let mut deployments = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, snapshot_id, target_host, host_version, scope, target_path, state FROM skill_deployment ORDER BY id DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "snapshot_id": row.get::<_, String>(1)?,
                    "target_host": row.get::<_, String>(2)?,
                    "host_version": row.get::<_, String>(3)?,
                    "scope": row.get::<_, String>(4)?,
                    "target_path": row.get::<_, String>(5)?,
                    "state": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            deployments.push(r);
        }
    }
    let mut evidence_view = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT skill_snapshot_id, target_host_id, host_version, deployment_scope, stage, status, observer, observed_at FROM evidence ORDER BY id DESC LIMIT 50")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let snap_id: String = row.get(0)?;
                let host_id: String = row.get(1)?;
                let host_ver: String = row.get(2)?;
                let short_snap = if snap_id.len() > 12 {
                    format!("{}…{}", &snap_id[..4], &snap_id[snap_id.len() - 4..])
                } else {
                    snap_id
                };
                Ok(serde_json::json!({
                    "key": format!("{} × {}@{}", short_snap, host_id, host_ver),
                    "stage": row.get::<_, String>(4)?,
                    "status": row.get::<_, String>(5)?,
                    "observer": row.get::<_, String>(6)?,
                    "observed_at": row.get::<_, String>(7)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            evidence_view.push(r);
        }
    }
    Ok(serde_json::json!({
        "snapshots": snapshots,
        "deployments": deployments,
        "evidence": evidence_view,
        "scope_dir": layout.runtimes.join("pi").join("test-scope").display().to_string(),
    }))
}

/// DSH 会话使用的工作目录：
/// 1. 优先使用宿主专属覆盖 host_workdir('dsh')；
/// 2. 其次使用全局活动项目 active_project；
/// 3. 最后回退到 sessions/dsh-workspace。
fn dsh_workspace(layout: &app_data::AppDataLayout, conn: Option<&rusqlite::Connection>) -> PathBuf {
    if let Some(conn) = conn {
        if let Ok(Some(hw)) = db::get_host_workdir(conn, "dsh") {
            let p = PathBuf::from(&hw);
            if p.is_dir() {
                return p;
            }
        }
        if let Ok(Some(ap)) = db::get_active_project(conn) {
            let p = PathBuf::from(&ap);
            if p.is_dir() {
                return p;
            }
        }
    }
    let dir = layout.sessions.join("dsh-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn locked_dsh_runtime() -> Result<DshRuntime, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = dsh_connector::discover(&root);
    if let Some(managed) = runtimes
        .iter()
        .find(|r| r.managed && r.version == dsh_connector::LOCKED_DSH_VERSION)
    {
        return Ok(managed.clone());
    }
    if let Some(external) = runtimes
        .iter()
        .find(|r| !r.managed && r.version == dsh_connector::LOCKED_DSH_VERSION)
    {
        return Ok(external.clone());
    }
    Err(format!(
        "DSH {} not found (Aster-managed under runtimes/dsh/{} or external)",
        dsh_connector::LOCKED_DSH_VERSION,
        dsh_connector::LOCKED_DSH_VERSION
    ))
}

#[tauri::command]
fn dsh_discover() -> Result<Vec<DshRuntime>, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = dsh_connector::discover(&root);
    if let Ok((_layout, conn)) = open_layout_and_db() {
        for r in &runtimes {
            let kind = if r.managed {
                "managed"
            } else {
                "recognized_external"
            };
            let _ = db::record_host_install(&conn, "dsh", kind, &r.version, &r.entry_path);
        }
    }
    Ok(runtimes)
}

#[tauri::command]
fn dsh_install_managed(version: Option<String>) -> Result<DshRuntime, String> {
    let ver = version
        .as_deref()
        .unwrap_or(dsh_connector::LOCKED_DSH_VERSION);
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtime = dsh_connector::install_managed(&root, ver)?;
    if let Ok((_layout, conn)) = open_layout_and_db() {
        let _ = db::record_host_install(
            &conn,
            "dsh",
            "managed",
            &runtime.version,
            &runtime.entry_path,
        );
    }
    Ok(runtime)
}

#[tauri::command]
async fn dsh_start(
    state: tauri::State<'_, DshSlot>,
    host: Option<String>,
    port: Option<u16>,
) -> Result<DshStatus, String> {
    let host = host.unwrap_or_else(|| "127.0.0.1".to_string());
    // Alpha 只允许回环地址：绑定到非回环接口会把本地宿主暴露到局域网。
    if host != "127.0.0.1" && host != "localhost" {
        return Err(format!(
            "only loopback host is supported in Alpha, got: {host}"
        ));
    }
    let runtime = locked_dsh_runtime()?;
    let (layout, conn) = open_layout_and_db()?;
    let workspace = dsh_workspace(&layout, Some(&conn));

    let mut guard = state
        .server
        .lock()
        .map_err(|e| format!("dsh server lock failed: {e}"))?;
    if let Some(existing) = guard.as_mut() {
        let _ = existing.stop();
    }

    let pref_port = port.unwrap_or(dsh_connector::DEFAULT_DSH_PORT);
    let server = DshServer::start(&layout.root, &runtime, &workspace, &host, pref_port)?;
    let status = server.status();
    *guard = Some(server);
    Ok(status)
}

#[tauri::command]
async fn dsh_stop(state: tauri::State<'_, DshSlot>) -> Result<(), String> {
    let mut guard = state
        .server
        .lock()
        .map_err(|e| format!("dsh server lock failed: {e}"))?;
    if let Some(mut server) = guard.take() {
        server.stop().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn dsh_status(state: tauri::State<DshSlot>) -> Result<Option<DshStatus>, String> {
    let guard = state
        .server
        .lock()
        .map_err(|e| format!("dsh server lock failed: {e}"))?;
    Ok(guard.as_ref().map(|s| s.status()))
}

// 注意必须是 async 命令：tauri 官方文档（WebviewWindowBuilder）明确说明
// Windows 上在同步命令或事件处理器中 build() 会死锁（wry#583：
// create_controller 的完成回调需要主线程消息泵，而同步命令的 IPC 回调
// 正占着它），正确做法是 async 命令 + 独立线程——async 命令在 tokio 工作
// 线程执行，wry 会把建窗 marshal 到主线程并以不阻塞消息泵的方式等待。
// 2026-08-18 实测反证：sync 命令 + run_on_main_thread 投递建窗仍整体死锁
// （HWND 建出、渲染进程孵化、导航永不发生，全部 IPC 派发瘫痪）——这正是
// 审计中“独立窗口空白 + 停止卡住 + 退出残留”的共同根因。
#[tauri::command]
async fn dsh_open_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, DshSlot>,
) -> Result<String, String> {
    // 只在极短临界区内读取 URL。
    let url_str = {
        let guard = state
            .server
            .lock()
            .map_err(|e| format!("dsh server lock failed: {e}"))?;
        let server = guard.as_ref().ok_or("DSH server is not running")?;
        server.url().to_string()
    };
    let url: tauri::Url = url_str.parse().map_err(|e| format!("invalid URL: {e}"))?;

    if let Some(win) = app.get_webview_window("dsh-native-ui") {
        let _ = win.set_focus();
        return Ok(url_str);
    }
    tauri::WebviewWindowBuilder::new(&app, "dsh-native-ui", tauri::WebviewUrl::External(url))
        .title("DeepSeek Harness - Native Web UI")
        .inner_size(1024.0, 768.0)
        .build()
        .map_err(|e| format!("failed to open DSH independent window: {e}"))?;
    Ok(url_str)
}

#[tauri::command]
fn host_profiles_list(
    project_root: Option<String>,
) -> Result<Vec<host_profile::DiscoveredHost>, String> {
    let p_str = match project_root {
        Some(p) if !p.trim().is_empty() => Some(p),
        _ => {
            if let Ok((_layout, conn)) = open_layout_and_db() {
                db::get_active_project(&conn).ok().flatten()
            } else {
                None
            }
        }
    };
    let p = p_str.as_ref().map(std::path::Path::new);
    Ok(host_profile::scan_all_hosts(p))
}

#[tauri::command]
fn skills_scan_repo(
    repo_path: Option<String>,
    repo_name: Option<String>,
) -> Result<skill_flow::SkillRepoGroup, String> {
    let (layout, conn) = open_layout_and_db()?;
    let path = match repo_path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => {
            let default_p = layout.staging.join("repo");
            if default_p.is_dir() {
                default_p
            } else {
                return Err("未指定本地目录路径，且暂存区无可用仓库。请在输入框中提供本地仓库或技能目录的绝对路径。".into());
            }
        }
    };
    if !path.exists() {
        return Err(format!("指定路径不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("指定路径不是有效文件夹: {}", path.display()));
    }
    let name = repo_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "local-repo".into())
        });
    let group = skill_flow::scan_multi_skill_repo(
        &path,
        &name,
        "local",
        Some(&layout.translations),
        Some(&layout.skills),
    )?;

    // 登记扫描快照元数据到 SQLite
    for sk in &group.skills {
        let snap_dir = layout.skills.join("snapshots").join(&sk.snapshot_id);
        if snap_dir.exists() {
            let snap = skill_flow::Snapshot {
                id: sk.snapshot_id.clone(),
                skill_name: sk.name.clone(),
                root_dir: snap_dir,
                file_count: sk.file_count,
                content_sha: sk.content_sha.clone(),
            };
            let src = skill_flow::SkillSource {
                repo: group.repo_name.clone(),
                commit_sha: group.commit_or_version.clone(),
                skill_path: sk.relative_path.clone(),
            };
            let _ = skill_flow::record_snapshot(&conn, &src, &snap);
        }
    }

    Ok(group)
}

fn allowed_deployment_roots(layout: &app_data::AppDataLayout) -> Vec<PathBuf> {
    let mut roots = vec![layout.root.clone(), layout.runtimes.clone()];
    for host in host_profile::scan_all_hosts(None) {
        for scope in host.discovered_scopes {
            let path = PathBuf::from(scope.resolved_path);
            if let Some(parent) = path.parent() {
                roots.push(parent.to_path_buf());
            }
            roots.push(path);
        }
    }
    roots
}

#[tauri::command]
fn skill_get_diff(
    base_snapshot_id: String,
    head_snapshot_id: String,
) -> Result<skill_flow::SnapshotDiff, String> {
    if !skill_flow::is_safe_id_segment(&base_snapshot_id) {
        return Err(format!("invalid base_snapshot_id: {base_snapshot_id}"));
    }
    if !skill_flow::is_safe_id_segment(&head_snapshot_id) {
        return Err(format!("invalid head_snapshot_id: {head_snapshot_id}"));
    }
    let (layout, _conn) = open_layout_and_db()?;
    let base_dir = layout.skills.join("snapshots").join(&base_snapshot_id);
    let head_dir = layout.skills.join("snapshots").join(&head_snapshot_id);
    skill_flow::snapshot_diff(&base_dir, &head_dir, &base_snapshot_id, &head_snapshot_id)
}

#[tauri::command]
fn skill_get_translation(
    skill_name: String,
    current_snapshot_id: Option<String>,
) -> Result<Option<skill_flow::TranslationDoc>, String> {
    if !skill_flow::is_safe_id_segment(&skill_name) {
        return Err(format!("invalid skill_name: {skill_name}"));
    }
    if let Some(ref snap_id) = current_snapshot_id {
        if !skill_flow::is_safe_id_segment(snap_id) {
            return Err(format!("invalid current_snapshot_id: {snap_id}"));
        }
    }
    let (layout, _conn) = open_layout_and_db()?;
    skill_flow::load_translation(
        &layout.translations,
        &skill_name,
        current_snapshot_id.as_deref(),
    )
}

#[tauri::command]
fn skill_save_translation(doc: skill_flow::TranslationDoc) -> Result<(), String> {
    if !skill_flow::is_safe_id_segment(&doc.skill_name) {
        return Err(format!("invalid doc.skill_name: {}", doc.skill_name));
    }
    if !skill_flow::is_safe_id_segment(&doc.snapshot_id) {
        return Err(format!("invalid doc.snapshot_id: {}", doc.snapshot_id));
    }
    let (layout, conn) = open_layout_and_db()?;
    skill_flow::save_translation(Some(&conn), &layout.translations, &doc)
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct SkillItemDto {
    pub id: String, // 快照唯一 ID（作为前端主键）
    pub skill_name: String,
    pub desc: String,
    pub tools: Vec<String>,
    pub updated: String,
    pub original: String,
    pub zh: String,
    pub snapshot_id: String,
    pub previous_snapshot_id: Option<String>,
    pub file_count: usize,
    pub content_sha: String,
}

#[tauri::command]
fn skills_list() -> Result<Vec<SkillItemDto>, String> {
    let (layout, conn) = open_layout_and_db()?;
    let mut stmt = conn
        .prepare("SELECT id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at FROM skill_snapshot ORDER BY skill_name ASC, created_at DESC, id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)? as usize,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let raw_list: Vec<_> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 计算同名 skill 的历史前驱快照（按 created_at DESC 排序后，紧邻的下一个快照即为其前驱版本）
    let mut items_with_prev = Vec::new();
    let total = raw_list.len();
    for i in 0..total {
        let (snap_id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at) =
            &raw_list[i];
        let previous_snapshot_id = if i + 1 < total && raw_list[i + 1].3 == *skill_name {
            Some(raw_list[i + 1].0.clone())
        } else {
            None
        };
        items_with_prev.push((
            snap_id.clone(),
            source_repo.clone(),
            commit_sha.clone(),
            skill_name.clone(),
            *file_count,
            content_sha.clone(),
            created_at.clone(),
            previous_snapshot_id,
        ));
    }

    let mut skills = Vec::new();
    for (
        snap_id,
        _source_repo,
        _commit_sha,
        skill_name,
        file_count,
        content_sha,
        created_at,
        previous_snapshot_id,
    ) in items_with_prev
    {
        let trans = skill_flow::load_translation(&layout.translations, &skill_name, Some(&snap_id))
            .ok()
            .flatten();
        let desc = trans
            .as_ref()
            .map(|t| t.purpose.clone())
            .unwrap_or_else(|| format!("{skill_name} ({file_count} 个文件)"));
        let tools = trans
            .as_ref()
            .map(|t| t.target_tools.clone())
            .unwrap_or_default();
        let zh = trans
            .as_ref()
            .map(|t| t.markdown_body.clone())
            .unwrap_or_default();

        let snap_dir = layout.skills.join("snapshots").join(&snap_id);
        let mut original = String::new();
        if snap_dir.exists() {
            if let Ok(files) = skill_flow::collect_files(&snap_dir) {
                for (rel, abs) in files {
                    if rel.eq_ignore_ascii_case("readme.md") || rel.eq_ignore_ascii_case("skill.md")
                    {
                        if let Ok(content) = std::fs::read_to_string(abs) {
                            original = content;
                            break;
                        }
                    }
                }
            }
        }
        if original.is_empty() {
            original = format!("# {skill_name}\n\n文件数量: {file_count}\n快照 ID: {snap_id}");
        }

        skills.push(SkillItemDto {
            id: snap_id.clone(),
            skill_name,
            desc,
            tools,
            updated: created_at,
            original,
            zh,
            snapshot_id: snap_id,
            previous_snapshot_id,
            file_count,
            content_sha,
        });
    }

    // 最终按更新时间降序展示
    skills.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(skills)
}

#[tauri::command]
fn skill_batch_deploy_plan(
    snapshot_id: String,
    targets: Vec<skill_flow::DeploymentTarget>,
) -> Result<skill_flow::DeploymentPlan, String> {
    if !skill_flow::is_safe_id_segment(&snapshot_id) {
        return Err(format!("invalid snapshot_id: {snapshot_id}"));
    }
    let (layout, conn) = open_layout_and_db()?;
    let snap_dir = layout.skills.join("snapshots").join(&snapshot_id);
    if !snap_dir.exists() {
        return Err(format!(
            "快照目录未找到: {snapshot_id} (路径: {})",
            snap_dir.display()
        ));
    }
    let skill_name = snapshot_id
        .split_once('-')
        .map(|(_, s)| s.to_string())
        .unwrap_or_else(|| snapshot_id.clone());
    let snap = skill_flow::Snapshot {
        id: snapshot_id.clone(),
        skill_name: skill_name.clone(),
        root_dir: snap_dir,
        file_count: 0,
        content_sha: "".into(),
    };
    let resolved_targets = skill_flow::resolve_deployment_targets(&targets, &skill_name, None);
    let managed_roots = allowed_deployment_roots(&layout);
    Ok(skill_flow::plan_batch_deployment(
        &conn,
        &snap,
        &resolved_targets,
        &managed_roots,
    ))
}

#[tauri::command]
fn skill_batch_deploy_apply(
    snapshot_id: String,
    targets: Vec<skill_flow::DeploymentTarget>,
) -> Result<skill_flow::BatchDeployResult, String> {
    if !skill_flow::is_safe_id_segment(&snapshot_id) {
        return Err(format!("invalid snapshot_id: {snapshot_id}"));
    }
    let (layout, mut conn) = open_layout_and_db()?;
    let snap_dir = layout.skills.join("snapshots").join(&snapshot_id);
    if !snap_dir.exists() {
        return Err(format!("Snapshot {snapshot_id} directory not found"));
    }
    let content_sha = skill_flow::content_hash(&snap_dir).map_err(|e| e.to_string())?;
    let files = skill_flow::collect_files(&snap_dir).map_err(|e| e.to_string())?;
    let skill_name = snapshot_id
        .split_once('-')
        .map(|(_, s)| s.to_string())
        .unwrap_or_else(|| snapshot_id.clone());
    let snap = skill_flow::Snapshot {
        id: snapshot_id.clone(),
        skill_name: skill_name.clone(),
        root_dir: snap_dir,
        file_count: files.len(),
        content_sha,
    };
    let resolved_targets = skill_flow::resolve_deployment_targets(&targets, &skill_name, None);
    let managed_roots = allowed_deployment_roots(&layout);
    skill_flow::deploy_batch_planned(&mut conn, &snap, &resolved_targets, &managed_roots)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProjectDto {
    pub path: String,
    pub display_name: String,
    pub last_opened_at: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePollResult {
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubAuthStatus {
    pub has_token: bool,
    pub source: String,
}

#[tauri::command]
fn project_choose(
    runtime: tauri::State<PiRuntimeManager>,
    path: String,
) -> Result<RecentProjectDto, String> {
    let clean = path.trim();
    if clean.is_empty() {
        return Err("项目路径不能为空".into());
    }
    let p = PathBuf::from(clean);
    if !p.exists() {
        return Err(format!("目录不存在: {}", p.display()));
    }
    if !p.is_dir() {
        return Err(format!("指定路径不是有效文件夹: {}", p.display()));
    }
    let display_name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| clean.to_string());

    let binding = runtime.active_binding();
    match decide_activate_project(binding.as_ref(), &p)? {
        ActivateProjectDecision::Noop => {
            return Ok(RecentProjectDto {
                path: clean.to_string(),
                display_name,
                last_opened_at: chrono::Utc::now().to_rfc3339(),
                is_active: true,
            });
        }
        ActivateProjectDecision::Proceed => {}
    }

    let (_layout, conn) = open_layout_and_db()?;
    db::record_recent_project(&conn, clean, &display_name).map_err(|e| e.to_string())?;
    db::set_active_project(&conn, clean).map_err(|e| e.to_string())?;

    Ok(RecentProjectDto {
        path: clean.to_string(),
        display_name,
        last_opened_at: chrono::Utc::now().to_rfc3339(),
        is_active: true,
    })
}

#[tauri::command]
fn project_recent_list() -> Result<Vec<RecentProjectDto>, String> {
    let (_layout, conn) = open_layout_and_db()?;
    let active = db::get_active_project(&conn).unwrap_or(None);
    let records = db::list_recent_projects(&conn).map_err(|e| e.to_string())?;
    let res = records
        .into_iter()
        .map(|r| {
            let is_active = active.as_deref() == Some(&r.path);
            RecentProjectDto {
                path: r.path,
                display_name: r.display_name,
                last_opened_at: r.last_opened_at,
                is_active,
            }
        })
        .collect();
    Ok(res)
}

#[tauri::command]
fn project_get_active() -> Result<Option<String>, String> {
    let (_layout, conn) = open_layout_and_db()?;
    db::get_active_project(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn project_set_active(
    runtime: tauri::State<PiRuntimeManager>,
    path: String,
) -> Result<(), String> {
    let clean = path.trim();
    let p = PathBuf::from(clean);
    if !p.is_dir() {
        return Err(format!("目录不存在或不是文件夹: {}", p.display()));
    }
    let binding = runtime.active_binding();
    match decide_activate_project(binding.as_ref(), &p)? {
        ActivateProjectDecision::Noop => return Ok(()),
        ActivateProjectDecision::Proceed => {}
    }
    let (_layout, conn) = open_layout_and_db()?;
    let display_name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| clean.to_string());
    db::record_recent_project(&conn, clean, &display_name).map_err(|e| e.to_string())?;
    db::set_active_project(&conn, clean).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn project_remove(runtime: tauri::State<PiRuntimeManager>, path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    decide_remove_project(runtime.active_binding().as_ref(), &p)?;
    let (_layout, conn) = open_layout_and_db()?;
    db::remove_recent_project(&conn, path.trim()).map_err(|e| e.to_string())?;
    if let Ok(Some(active)) = db::get_active_project(&conn) {
        if active == path.trim() {
            let _ = conn.execute("DELETE FROM meta WHERE key = 'active_project'", []);
        }
    }
    Ok(())
}

#[tauri::command]
fn project_pick_directory() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择 Aster 工作目录 / 项目根目录")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn host_workdir_set(host: String, path: String) -> Result<(), String> {
    let clean_path = path.trim();
    if !clean_path.is_empty() {
        let p = PathBuf::from(clean_path);
        if !p.is_dir() {
            return Err(format!("宿主目录不存在: {}", p.display()));
        }
    }
    let (_layout, conn) = open_layout_and_db()?;
    db::set_host_workdir(&conn, &host, clean_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn host_workdir_get(host: String) -> Result<Option<String>, String> {
    let (_layout, conn) = open_layout_and_db()?;
    db::get_host_workdir(&conn, &host).map_err(|e| e.to_string())
}

#[tauri::command]
fn skills_scan_github(
    repo: String,
    git_ref: Option<String>,
    skill_path: Option<String>,
) -> Result<skill_flow::SkillRepoGroup, String> {
    let (layout, conn) = open_layout_and_db()?;
    let token = credentials::get_github_token();
    // 先把分支名/HEAD 等可移动指针解析为真实 commit sha，再扫描与登记快照；
    // 否则快照 id 的版本段恒为 "HEAD"，上游更新后重扫无法形成新快照与 Diff。
    let resolved_sha = skill_flow::resolve_github_ref(&repo, git_ref.as_deref(), token.as_deref())?;
    let repo_dir = skill_flow::download_and_extract_github_repo(
        &repo,
        git_ref.as_deref(),
        token.as_deref(),
        &layout.staging,
    )?;

    let target_scan_path = if let Some(ref sp) = skill_path {
        let trimmed = sp.trim().trim_matches('/');
        if !trimmed.is_empty() {
            let sub = repo_dir.join(trimmed);
            if sub.is_dir() {
                sub
            } else {
                repo_dir.clone()
            }
        } else {
            repo_dir.clone()
        }
    } else {
        repo_dir.clone()
    };

    let group = skill_flow::scan_multi_skill_repo(
        &target_scan_path,
        &repo,
        &resolved_sha,
        Some(&layout.translations),
        Some(&layout.skills),
    )?;

    // 登记扫描快照元数据到 SQLite
    for sk in &group.skills {
        let snap_dir = layout.skills.join("snapshots").join(&sk.snapshot_id);
        if snap_dir.exists() {
            let snap = skill_flow::Snapshot {
                id: sk.snapshot_id.clone(),
                skill_name: sk.name.clone(),
                root_dir: snap_dir,
                file_count: sk.file_count,
                content_sha: sk.content_sha.clone(),
            };
            let src = skill_flow::SkillSource {
                repo: group.repo_name.clone(),
                commit_sha: group.commit_or_version.clone(),
                skill_path: sk.relative_path.clone(),
            };
            let _ = skill_flow::record_snapshot(&conn, &src, &snap);
        }
    }

    Ok(group)
}

#[tauri::command]
fn github_device_start(client_id: Option<String>) -> Result<DeviceCodeResponse, String> {
    let cid = client_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Ov23liAsterDesktop".to_string());

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(15))
        .build();

    let body = serde_json::json!({
        "client_id": cid,
        "scope": "repo,read:user"
    })
    .to_string();

    let resp = agent
        .post("https://github.com/login/device/code")
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .set("User-Agent", "Aster-Desktop")
        .send_string(&body)
        .map_err(|e| format!("request device code failed: {e}"))?;

    let text = resp
        .into_string()
        .map_err(|e| format!("read response: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse response: {e}"))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or(err);
        return Err(format!("GitHub device code error: {desc}"));
    }

    Ok(DeviceCodeResponse {
        device_code: json
            .get("device_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        user_code: json
            .get("user_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        verification_uri: json
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("https://github.com/login/device")
            .to_string(),
        expires_in: json
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(900),
        interval: json.get("interval").and_then(|v| v.as_u64()).unwrap_or(5),
    })
}

#[tauri::command]
fn github_device_poll(client_id: String, device_code: String) -> Result<DevicePollResult, String> {
    let cid = if client_id.trim().is_empty() {
        "Ov23liAsterDesktop".to_string()
    } else {
        client_id.trim().to_string()
    };

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(15))
        .build();

    let body = serde_json::json!({
        "client_id": cid,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    })
    .to_string();

    let resp = agent
        .post("https://github.com/login/oauth/access_token")
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .set("User-Agent", "Aster-Desktop")
        .send_string(&body)
        .map_err(|e| format!("poll token failed: {e}"))?;

    let text = resp
        .into_string()
        .map_err(|e| format!("read response: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse response: {e}"))?;
    if let Some(token) = json.get("access_token").and_then(|v| v.as_str()) {
        credentials::set_github_token(token)?;
        return Ok(DevicePollResult {
            status: "success".into(),
            error: None,
        });
    }

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        match err {
            "authorization_pending" => Ok(DevicePollResult {
                status: "pending".into(),
                error: None,
            }),
            "slow_down" => Ok(DevicePollResult {
                status: "slow_down".into(),
                error: None,
            }),
            "expired_token" => Ok(DevicePollResult {
                status: "expired".into(),
                error: Some("授权已超时，请重新发起".into()),
            }),
            "access_denied" => Ok(DevicePollResult {
                status: "denied".into(),
                error: Some("用户拒绝了授权请求".into()),
            }),
            other => Ok(DevicePollResult {
                status: "error".into(),
                error: Some(format!("GitHub 返回错误: {other}")),
            }),
        }
    } else {
        Ok(DevicePollResult {
            status: "unknown".into(),
            error: Some("未识别的 GitHub 响应格式".into()),
        })
    }
}

#[tauri::command]
fn github_token_status() -> Result<GithubAuthStatus, String> {
    Ok(GithubAuthStatus {
        has_token: credentials::has_github_token(),
        source: "windows_credential_manager".into(),
    })
}

#[tauri::command]
fn github_set_pat(pat: String) -> Result<(), String> {
    let clean = pat.trim();
    if clean.is_empty() {
        return Err("Personal Access Token 不能为空".into());
    }
    credentials::set_github_token(clean)
}

#[tauri::command]
fn github_logout() -> Result<(), String> {
    credentials::delete_github_token()
}

#[tauri::command]
fn skill_quarantine_list() -> Result<Vec<skill_flow::QuarantineItemDto>, String> {
    let (layout, conn) = open_layout_and_db()?;
    skill_flow::list_quarantine_items(&conn, &layout.quarantine)
}

#[tauri::command]
fn skill_quarantine_delete(quarantine_id: String) -> Result<(), String> {
    if !skill_flow::is_safe_id_segment(&quarantine_id) {
        return Err(format!("invalid quarantine_id: {quarantine_id}"));
    }
    let (layout, conn) = open_layout_and_db()?;
    skill_flow::delete_quarantine_item(&conn, &layout.quarantine, &quarantine_id)
}

pub fn run() {
    // 必须最早执行：后续所有诊断记录都靠它判定 on_main。
    diag::init_main_thread();

    // 用 Wry 显式定型，才能把 generate_handler! 的闭包先绑定再包一层诊断。
    // 这一层是审计期唯一的 IPC 观测点：它对同步命令测到的是命令体的完整耗时
    // （sync command 在 wry IPC 回调里内联执行），对 async 命令只测到派发耗时。
    // 因此 elapsed_ms 本身就是「该命令是否占用主线程」的判据。
    type WryInvoke = tauri::ipc::Invoke<tauri::Wry>;
    let invoke_handler: Box<dyn Fn(WryInvoke) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            get_app_status,
            pi_discover,
            pi_install_managed,
            pi_session_status,
            pi_session_observation,
            pi_get_available_models,
            pi_set_model,
            pi_get_state,
            pi_commands::pi_project_tree_refresh,
            pi_commands::pi_session_create,
            pi_commands::pi_session_open,
            pi_commands::pi_session_snapshot,
            pi_commands::pi_session_set_name,
            pi_commands::pi_session_set_model,
            pi_commands::pi_session_set_thinking_level,
            pi_commands::pi_session_prompt,
            pi_commands::pi_session_abort,
            pi_commands::pi_session_stop,
            pi_commands::pi_session_index_remove,
            pi_commands::pi_runtime_snapshot,
            dsh_discover,
            dsh_install_managed,
            dsh_start,
            dsh_stop,
            dsh_status,
            dsh_open_window,
            skill_status,
            skills_list,
            host_profiles_list,
            skills_scan_repo,
            skills_scan_github,
            skill_get_diff,
            skill_get_translation,
            skill_save_translation,
            skill_batch_deploy_plan,
            skill_batch_deploy_apply,
            project_choose,
            project_recent_list,
            project_get_active,
            project_set_active,
            project_remove,
            project_pick_directory,
            host_workdir_set,
            host_workdir_get,
            github_device_start,
            github_device_poll,
            github_token_status,
            github_set_pat,
            github_logout,
            skill_quarantine_list,
            skill_quarantine_delete
        ]);

    tauri::Builder::default()
        .manage(PiRuntimeManager::default())
        .manage(DshSlot {
            server: Mutex::new(None),
        })
        .invoke_handler(move |invoke| {
            let _span = diag::span("ipc", invoke.message.command().to_string());
            invoke_handler(invoke)
        })
        .on_window_event(|window, event| {
            // 窗口事件序列是「点 X 之后停在哪一步」的第一段证据：
            // 缺失 CloseRequested 说明点击根本没被投递（消息泵被占），
            // 有 CloseRequested 但没有后续 RunEvent::Exit 说明卡在清理。
            let name = match event {
                tauri::WindowEvent::CloseRequested { .. } => Some("close_requested"),
                tauri::WindowEvent::Destroyed => Some("destroyed"),
                tauri::WindowEvent::Focused(_) => Some("focused"),
                tauri::WindowEvent::Resized(_) => None, // 高频，不记录
                tauri::WindowEvent::Moved(_) => None,   // 高频，不记录
                _ => Some("other"),
            };
            if let Some(name) = name {
                diag::record(
                    "window",
                    serde_json::json!({ "event": name, "window": window.label() }),
                );
            }

            // 主窗口关闭 = 应用退出：先关闭其余窗口（如 DSH 原生界面）。
            // 否则主窗口销毁后剩余窗口会让整个进程继续存活——这就是
            // 2026-08-18 审计中“关闭主窗口后 Aster/DSH 进程残留”的直接原因。
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    for (label, win) in window.webview_windows() {
                        if label != "main" {
                            let _span = diag::span("shutdown", format!("close_window:{label}"));
                            let _ = win.close();
                        }
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            if let Some(name) = run_event_name(&event) {
                diag::record("runevent", serde_json::json!({ "event": name }));
            }
            // 应用真正退出前兜底清理：停止仍在运行的宿主子进程树。
            if matches!(event, tauri::RunEvent::Exit) {
                // 整个 Exit 清理都在主线程上；这个 Span 的 elapsed_ms 就是
                // “窗口已消失但 aster.exe 仍在任务管理器里”的那段时间。
                let _exit_span = diag::span("shutdown", "run_event_exit");
                // 用 try_lock 而非 lock：若锁被卡死的后台任务长期持有（例如
                // WebView2 第二窗口初始化挂起期间的建窗命令），退出流程不得
                // 随之挂死——宁可跳过兜底停止，也不能让进程退不出。
                let dsh = handle.state::<DshSlot>();
                {
                    let mut span = diag::span("shutdown", "dsh_stop");
                    match dsh.server.try_lock() {
                        Ok(mut guard) => match guard.take() {
                            Some(mut server) => {
                                let pid = server.pid();
                                let result = server.stop();
                                if let Some(s) = span.as_mut() {
                                    s.note(format!("pid={pid} ok={}", result.is_ok()));
                                }
                            }
                            None => {
                                if let Some(s) = span.as_mut() {
                                    s.note("no running dsh");
                                }
                            }
                        },
                        Err(_) => {
                            if let Some(s) = span.as_mut() {
                                s.note("try_lock failed; skipped");
                            }
                        }
                    }
                }
                {
                    let mut span = diag::span("shutdown", "pi_stop");
                    let pi = handle.state::<PiRuntimeManager>();
                    let result = pi.stop();
                    if let Some(s) = span.as_mut() {
                        s.note(format!("ok={}", result.is_ok()));
                    }
                }
            }
        });
}

/// RunEvent 的稳定短名。高频事件返回 None，避免诊断自身变成噪声源。
fn run_event_name(event: &tauri::RunEvent) -> Option<&'static str> {
    match event {
        tauri::RunEvent::Exit => Some("exit"),
        tauri::RunEvent::ExitRequested { .. } => Some("exit_requested"),
        tauri::RunEvent::WindowEvent { .. } => None,
        tauri::RunEvent::WebviewEvent { .. } => None,
        tauri::RunEvent::Ready => Some("ready"),
        tauri::RunEvent::Resumed => Some("resumed"),
        tauri::RunEvent::MainEventsCleared => None,
        _ => None,
    }
}

#[cfg(test)]
mod command_threading_tests {
    use super::*;

    // wry#583 / tauri 官方文档：Windows 上在同步命令或事件处理器中 build() 第二个
    // WebView2 窗口会死锁主线程（2026-08-18 实测：HWND 建出、渲染进程孵化，但初始化
    // 永不完成，此后全部 IPC 命令派发与窗口消息处理瘫瘊，表现为“独立窗口空白 +
    // 停止卡住 + 退出残留”）。GUI 死锁无法在 CI 重现，这里用类型系统锁定
    // dsh_open_window 保持 async：一旦被改回同步 fn，本测试编译失败。
    #[test]
    fn dsh_open_window_stays_async() {
        fn is_future<F: std::future::Future>(_: &F) {}
        let _check = |app: tauri::AppHandle, state: tauri::State<'_, DshSlot>| {
            is_future(&dsh_open_window(app, state));
        };
    }
}
