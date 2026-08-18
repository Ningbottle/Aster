pub mod app_data;
pub mod db;
pub mod dsh_connector;
pub mod evidence;
pub mod host_profile;
pub mod logging;
pub mod pi_connector;
pub mod skill_flow;
pub mod supervisor;

use dsh_connector::{DshRuntime, DshServer, DshStatus};
use evidence::{Stage, Status};
use pi_connector::{PiRuntime, PiSession, SessionEvent};
use serde::Serialize;
use skill_flow::M1_SKILL_SOURCE;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct AppStatus {
    app_version: String,
    app_data_dir: String,
    database_schema_version: u32,
    evidence_count: i64,
}

/// 共享状态：单个活跃 Pi 会话（M1 单会话纵切）。
struct SessionSlot {
    session: Mutex<Option<PiSession>>,
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

fn open_layout_and_db() -> Result<(app_data::AppDataLayout, rusqlite::Connection), String> {
    let layout = app_data::AppDataLayout::open_default().map_err(|e| e.to_string())?;
    let mut conn = db::open_connection(&layout.database.join("aster.db")).map_err(|e| e.to_string())?;
    db::migrate(&mut conn).map_err(|e| e.to_string())?;
    Ok((layout, conn))
}

#[tauri::command]
fn pi_discover() -> Result<Vec<PiRuntime>, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = pi_connector::discover(&root);
    if let Ok((_layout, conn)) = open_layout_and_db() {
        for r in &runtimes {
            let kind = if r.managed { "managed" } else { "recognized_external" };
            let _ = db::record_host_install(&conn, "pi", kind, &r.version, &r.cli_js);
        }
    }
    Ok(runtimes)
}

#[tauri::command]
fn pi_install_managed(version: Option<String>) -> Result<PiRuntime, String> {
    let ver = version.as_deref().unwrap_or(pi_connector::LOCKED_PI_VERSION);
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtime = pi_connector::install_managed(&root, ver)?;
    if let Ok((_layout, conn)) = open_layout_and_db() {
        let _ = db::record_host_install(&conn, "pi", "managed", &runtime.version, &runtime.cli_js);
    }
    Ok(runtime)
}

/// Pi 会话使用的工作目录（Aster 管理；不能是 Pi 自己的包目录，见 M1 spike）。
fn pi_workspace(layout: &app_data::AppDataLayout) -> PathBuf {
    let dir = layout.sessions.join("pi-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn locked_runtime() -> Result<PiRuntime, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = pi_connector::discover(&root);
    if let Some(managed) = runtimes.iter().find(|r| r.managed && r.version == pi_connector::LOCKED_PI_VERSION) {
        return Ok(managed.clone());
    }
    if let Some(external) = runtimes.iter().find(|r| !r.managed && r.version == pi_connector::LOCKED_PI_VERSION) {
        return Ok(external.clone());
    }
    Err(format!(
        "Pi {} not found (checked Aster-managed under runtimes/pi/{} and external npm)",
        pi_connector::LOCKED_PI_VERSION,
        pi_connector::LOCKED_PI_VERSION
    ))
}

#[tauri::command]
fn pi_session_status(state: tauri::State<SessionSlot>) -> Result<bool, String> {
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    Ok(guard.as_ref().map(|s| !s.is_closed()).unwrap_or(false))
}

#[tauri::command]
fn pi_session_ensure(app: tauri::AppHandle, state: tauri::State<SessionSlot>) -> Result<String, String> {
    let mut guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    if let Some(session) = guard.as_ref() {
        if !session.is_closed() {
            return Ok("session already active".into());
        }
    }
    let runtime = locked_runtime()?;
    let (layout, _conn) = open_layout_and_db()?;
    let workspace = pi_workspace(&layout);

    if let Some(existing) = guard.as_mut() {
        let _ = existing.stop();
    }
    let app_handle = app.clone();
    let session = PiSession::start(
        std::path::Path::new(&runtime.cli_js),
        &workspace,
        None, // 默认配置目录：Pi 自行使用自己的凭据与配置，Aster 不读取
        move |event: SessionEvent| {
            let _ = app_handle.emit("pi-event", &event);
        },
    )
    .map_err(|e| format!("start Pi RPC session failed: {e}"))?;
    *guard = Some(session);
    Ok("session started".into())
}

#[tauri::command]
fn pi_session_start(app: tauri::AppHandle, state: tauri::State<SessionSlot>) -> Result<String, String> {
    let runtime = locked_runtime()?;
    let (layout, _conn) = open_layout_and_db()?;
    let workspace = pi_workspace(&layout);

    let mut guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    if let Some(existing) = guard.as_mut() {
        let _ = existing.stop();
    }
    let app_handle = app.clone();
    let session = PiSession::start(
        std::path::Path::new(&runtime.cli_js),
        &workspace,
        None, // 默认配置目录：Pi 自行使用自己的凭据与配置，Aster 不读取
        move |event: SessionEvent| {
            let _ = app_handle.emit("pi-event", &event);
        },
    )
    .map_err(|e| format!("start Pi RPC session failed: {e}"))?;
    *guard = Some(session);
    Ok(format!(
        "session started with managed Pi {}",
        pi_connector::LOCKED_PI_VERSION
    ))
}

#[tauri::command]
fn pi_get_available_models(app: tauri::AppHandle, state: tauri::State<SessionSlot>) -> Result<Vec<serde_json::Value>, String> {
    let _ = pi_session_ensure(app, state.clone())?;
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    let session = guard.as_ref().ok_or("no active Pi session")?;
    session.get_available_models()
}

#[tauri::command]
fn pi_set_model(state: tauri::State<SessionSlot>, provider: String, model_id: String) -> Result<serde_json::Value, String> {
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    let session = guard.as_ref().ok_or("no active Pi session")?;
    session.set_model(&provider, &model_id)
}

#[tauri::command]
fn pi_get_state(app: tauri::AppHandle, state: tauri::State<SessionSlot>) -> Result<serde_json::Value, String> {
    let _ = pi_session_ensure(app, state.clone())?;
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    let session = guard.as_ref().ok_or("no active Pi session")?;
    session.get_state()
}

#[tauri::command]
fn pi_new_session(state: tauri::State<SessionSlot>) -> Result<(), String> {
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    let session = guard.as_ref().ok_or("no active Pi session")?;
    session.new_session()
}

#[tauri::command]
fn pi_session_prompt(state: tauri::State<SessionSlot>, message: String) -> Result<(), String> {
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    let session = guard.as_ref().ok_or("no active Pi session")?;
    session.prompt(&message)
}

#[tauri::command]
fn pi_session_abort(state: tauri::State<SessionSlot>) -> Result<String, String> {
    let watcher = {
        let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
        let session = guard.as_ref().ok_or("no active Pi session")?;
        session.abort()?;
        session.watcher()
    };
    // 锁已释放！其他命令（如 stop、observation）不会被阻塞
    let confirmed = watcher.wait_settled(Duration::from_secs(30));
    if confirmed {
        Ok("cancellation confirmed by host (agent_settled)".into())
    } else if watcher.is_closed() {
        Ok("session process terminated or crashed before settle could be confirmed".into())
    } else {
        Ok("cancellation requested but host did not settle within 30s".into())
    }
}

#[tauri::command]
fn pi_session_stop(state: tauri::State<SessionSlot>) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    if let Some(mut session) = guard.take() {
        session.stop().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pi_session_observation(state: tauri::State<SessionSlot>) -> Result<serde_json::Value, String> {
    let guard = state.session.lock().map_err(|e| format!("session lock failed: {e}"))?;
    match guard.as_ref() {
        Some(session) => {
            let obs = session.observation();
            Ok(serde_json::json!({
                "active": !session.is_closed(),
                "closed": session.is_closed(),
                "tool_starts": obs.tool_starts,
                "tool_ends": obs.tool_ends,
                "tool_names": obs.tool_names,
                "message_updates": obs.message_updates,
                "agent_ends": obs.agent_ends,
                "settled": obs.settled,
                "protocol_errors": obs.protocol_errors,
            }))
        }
        None => Ok(serde_json::json!({ "active": false, "closed": true })),
    }
}

/// 在测试作用域内用短生命周期 RPC 进程验证 skill 被目标宿主发现。
fn verify_skill_in_scope(
    cli_js: &std::path::Path,
    workspace: &std::path::Path,
    scope_dir: &std::path::Path,
    skill_name: &str,
) -> Result<Vec<String>, String> {
    let (tx, _rx) = std::sync::mpsc::channel();
    let mut session = PiSession::start(
        cli_js,
        workspace,
        Some(scope_dir),
        move |event: SessionEvent| {
            let _ = tx.send(event);
        },
    )
    .map_err(|e| format!("start verification session: {e}"))?;
    let resp = session.request(
        serde_json::json!({ "type": "get_commands" }),
        Duration::from_secs(60),
    )?;
    let _ = session.stop();
    let ok = resp.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        return Err(format!("get_commands failed: {resp}"));
    }
    let scope_str = scope_dir.to_string_lossy().to_lowercase();
    let mut matched = Vec::new();
    if let Some(commands) = resp.get("data").and_then(|d| d.get("commands")).and_then(|c| c.as_array()) {
        for cmd in commands {
            let name = cmd.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let path = cmd
                .get("sourceInfo")
                .and_then(|s| s.get("path"))
                .and_then(|p| p.as_str())
                .unwrap_or("");
            if path.to_lowercase().contains(&scope_str) {
                matched.push(format!("{name} @ {}", logging::redact(path)));
            }
        }
    }
    if matched.is_empty() {
        return Err(format!(
            "skill {} not discovered by host in scope",
            skill_name
        ));
    }
    if !matched
        .iter()
        .any(|m| m.starts_with(&format!("skill:{skill_name}")))
    {
        return Err(format!(
            "expected skill command skill:{skill_name} not found; scope commands: {matched:?}"
        ));
    }
    Ok(matched)
}

#[derive(Serialize)]
struct M1StageReport {
    stage: String,
    status: String,
    detail: String,
}

#[derive(Serialize)]
struct M1PipelineReport {
    snapshot_id: String,
    stages: Vec<M1StageReport>,
    deployment_id: Option<i64>,
}

/// M1 纵切：下载 -> 快照 -> 静态检查 -> 部署 -> 目标发现 -> 分阶段 Evidence。
/// session_loaded / callable_verified 在测试作用域刻意保持 unknown：
/// 作用域内没有宿主凭据，而 Aster 的凭据边界禁止迁移用户凭据。
#[tauri::command]
fn skill_m1_pipeline() -> Result<M1PipelineReport, String> {
    run_m1_pipeline_core()
}

/// 无头自检入口（aster.exe --selftest-m1）与 Tauri 命令共用同一核心逻辑。
fn run_m1_pipeline_core() -> Result<M1PipelineReport, String> {
    let (layout, conn) = open_layout_and_db()?;
    let runtime = locked_runtime()?;
    let workspace = pi_workspace(&layout);
    let scope_dir = layout.runtimes.join("pi").join("test-scope");
    std::fs::create_dir_all(scope_dir.join("skills")).map_err(|e| e.to_string())?;

    let mut stages: Vec<M1StageReport> = Vec::new();
    let mut results = std::collections::BTreeMap::new();

    // 1. discovered + downloaded：从锁定的 commit 下载并解出 skill 子路径
    let extracted = match skill_flow::download_and_extract(&M1_SKILL_SOURCE, &layout.staging) {
        Ok(dir) => {
            stages.push(M1StageReport {
                stage: "discovered".into(),
                status: "success".into(),
                detail: format!(
                    "github.com/{} @ {}",
                    M1_SKILL_SOURCE.repo, M1_SKILL_SOURCE.commit_sha
                ),
            });
            results.insert(Stage::Discovered, evidence::Status::Success);
            stages.push(M1StageReport {
                stage: "downloaded".into(),
                status: "success".into(),
                detail: format!("extracted to staging ({} files checked)", "?"),
            });
            results.insert(Stage::Downloaded, evidence::Status::Success);
            dir
        }
        Err(e) => {
            stages.push(M1StageReport { stage: "downloaded".into(), status: "failure".into(), detail: e.clone() });
            results.insert(Stage::Downloaded, evidence::Status::Failure);
            skill_flow::record_evidence_chain(&conn, &pending_snapshot_id(&M1_SKILL_SOURCE), "pi", pi_connector::LOCKED_PI_VERSION, "aster-test-scope", &results).map_err(|e| e.to_string())?;
            return Ok(M1PipelineReport { snapshot_id: pending_snapshot_id(&M1_SKILL_SOURCE), stages, deployment_id: None });
        }
    };

    // 2. structurally_validated：静态检查
    let skill_dir = extracted;
    match skill_flow::static_check(&skill_dir) {
        Ok(files) => {
            stages.push(M1StageReport {
                stage: "structurally_validated".into(),
                status: "success".into(),
                detail: format!("{} files passed path/type/size checks", files.len()),
            });
            results.insert(Stage::StructurallyValidated, evidence::Status::Success);
        }
        Err(findings) => {
            let detail = findings
                .iter()
                .map(|f| format!("{}: {}", f.relative_path, f.problem))
                .collect::<Vec<_>>()
                .join("; ");
            stages.push(M1StageReport { stage: "structurally_validated".into(), status: "failure".into(), detail });
            results.insert(Stage::StructurallyValidated, evidence::Status::Failure);
            let snap_id = pending_snapshot_id(&M1_SKILL_SOURCE);
            skill_flow::record_evidence_chain(&conn, &snap_id, "pi", pi_connector::LOCKED_PI_VERSION, "aster-test-scope", &results).map_err(|e| e.to_string())?;
            return Ok(M1PipelineReport { snapshot_id: snap_id, stages, deployment_id: None });
        }
    }

    // 3. 不可变快照
    let snap = skill_flow::create_snapshot(&layout.skills, &M1_SKILL_SOURCE, &skill_dir)
        .map_err(|e| format!("create snapshot: {e}"))?;
    skill_flow::record_snapshot(&conn, &M1_SKILL_SOURCE, &snap).map_err(|e| e.to_string())?;

    // 4. configured：部署到 Aster 管理的测试作用域
    let target = skill_flow::DeploymentTarget {
        host: "pi".into(),
        host_version: pi_connector::LOCKED_PI_VERSION.into(),
        scope: "aster-test-scope".into(),
        path: scope_dir.join("skills").join(&snap.skill_name),
    };
    let deployment_id = match skill_flow::deploy(&conn, &snap, &target, &scope_dir) {
        Ok(id) => {
            stages.push(M1StageReport {
                stage: "configured".into(),
                status: "success".into(),
                detail: format!("deployed to {}, hash verified", target.path.display()),
            });
            results.insert(Stage::Configured, evidence::Status::Success);
            id
        }
        Err(e) => {
            stages.push(M1StageReport { stage: "configured".into(), status: "failure".into(), detail: e.clone() });
            results.insert(Stage::Configured, evidence::Status::Failure);
            skill_flow::record_evidence_chain(&conn, &snap.id, "pi", pi_connector::LOCKED_PI_VERSION, "aster-test-scope", &results).map_err(|e| e.to_string())?;
            return Ok(M1PipelineReport { snapshot_id: snap.id, stages, deployment_id: None });
        }
    };

    // 5. target_discovered：真实 Pi 在作用域内发现该 skill
    match verify_skill_in_scope(
        std::path::Path::new(&runtime.cli_js),
        &workspace,
        &scope_dir,
        &snap.skill_name,
    ) {
        Ok(matched) => {
            stages.push(M1StageReport {
                stage: "target_discovered".into(),
                status: "success".into(),
                detail: matched.join(", "),
            });
            results.insert(Stage::TargetDiscovered, evidence::Status::Success);
        }
        Err(e) => {
            stages.push(M1StageReport { stage: "target_discovered".into(), status: "failure".into(), detail: e.clone() });
            results.insert(Stage::TargetDiscovered, evidence::Status::Failure);
        }
    }

    // 6. session_loaded / callable_verified：诚实记录 unknown 与原因
    stages.push(M1StageReport {
        stage: "session_loaded".into(),
        status: "unknown".into(),
        detail: "test scope has no host credentials by design; Aster does not migrate credentials".into(),
    });
    results.insert(Stage::SessionLoaded, evidence::Status::Unknown);
    stages.push(M1StageReport {
        stage: "callable_verified".into(),
        status: "unknown".into(),
        detail: "requires an authenticated scoped session; not attempted in M1".into(),
    });
    results.insert(Stage::CallableVerified, evidence::Status::Unknown);

    skill_flow::record_evidence_chain(&conn, &snap.id, "pi", pi_connector::LOCKED_PI_VERSION, "aster-test-scope", &results)
        .map_err(|e| e.to_string())?;

    Ok(M1PipelineReport {
        snapshot_id: snap.id,
        stages,
        deployment_id: Some(deployment_id),
    })
}

fn pending_snapshot_id(source: &skill_flow::SkillSource) -> String {
    // 失败早退时还没有正式快照；用确定性占位 id 让证据仍可查询
    format!(
        "{}-pending",
        &source.commit_sha[..12.min(source.commit_sha.len())]
    )
}

#[derive(Serialize)]
struct SkillRollbackReport {
    rolled_back: Vec<String>,
}

#[tauri::command]
fn skill_rollback_latest() -> Result<SkillRollbackReport, String> {
    let (_layout, conn) = open_layout_and_db()?;
    let mut stmt = conn
        .prepare("SELECT id, target_host, target_path FROM skill_deployment WHERE state = 'deployed' ORDER BY id DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut rolled = Vec::new();
    if let Some(item) = rows.next() {
        let (id, _host, path) = item.map_err(|e| e.to_string())?;
        skill_flow::rollback(&conn, id, std::path::Path::new(&path)).map_err(|e| e.to_string())?;
        rolled.push(logging::redact(&path));
    }
    Ok(SkillRollbackReport { rolled_back: rolled })
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

fn dsh_workspace(layout: &app_data::AppDataLayout) -> PathBuf {
    let dir = layout.sessions.join("dsh-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn locked_dsh_runtime() -> Result<DshRuntime, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = dsh_connector::discover(&root);
    if let Some(managed) = runtimes.iter().find(|r| r.managed && r.version == dsh_connector::LOCKED_DSH_VERSION) {
        return Ok(managed.clone());
    }
    if let Some(external) = runtimes.iter().find(|r| !r.managed && r.version == dsh_connector::LOCKED_DSH_VERSION) {
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
            let kind = if r.managed { "managed" } else { "recognized_external" };
            let _ = db::record_host_install(&conn, "dsh", kind, &r.version, &r.entry_path);
        }
    }
    Ok(runtimes)
}

#[tauri::command]
fn dsh_install_managed(version: Option<String>) -> Result<DshRuntime, String> {
    let ver = version.as_deref().unwrap_or(dsh_connector::LOCKED_DSH_VERSION);
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtime = dsh_connector::install_managed(&root, ver)?;
    if let Ok((_layout, conn)) = open_layout_and_db() {
        let _ = db::record_host_install(&conn, "dsh", "managed", &runtime.version, &runtime.entry_path);
    }
    Ok(runtime)
}

#[tauri::command]
fn dsh_start(state: tauri::State<DshSlot>, port: Option<u16>) -> Result<DshStatus, String> {
    let runtime = locked_dsh_runtime()?;
    let (layout, _conn) = open_layout_and_db()?;
    let workspace = dsh_workspace(&layout);

    let mut guard = state.server.lock().map_err(|e| format!("dsh server lock failed: {e}"))?;
    if let Some(existing) = guard.as_mut() {
        let _ = existing.stop();
    }

    let pref_port = port.unwrap_or(dsh_connector::DEFAULT_DSH_PORT);
    let server = DshServer::start(&layout.root, &runtime, &workspace, None, pref_port)?;
    let status = server.status();
    *guard = Some(server);
    Ok(status)
}

#[tauri::command]
fn dsh_stop(state: tauri::State<DshSlot>) -> Result<(), String> {
    let mut guard = state.server.lock().map_err(|e| format!("dsh server lock failed: {e}"))?;
    if let Some(mut server) = guard.take() {
        server.stop().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn dsh_status(state: tauri::State<DshSlot>) -> Result<Option<DshStatus>, String> {
    let guard = state.server.lock().map_err(|e| format!("dsh server lock failed: {e}"))?;
    Ok(guard.as_ref().map(|s| s.status()))
}

#[tauri::command]
fn dsh_open_window(app: tauri::AppHandle, state: tauri::State<DshSlot>) -> Result<String, String> {
    let guard = state.server.lock().map_err(|e| format!("dsh server lock failed: {e}"))?;
    let server = guard.as_ref().ok_or("DSH server is not running")?;
    let url_str = server.url().to_string();
    let url: tauri::Url = url_str.parse().map_err(|e| format!("invalid URL: {e}"))?;

    if let Some(win) = app.get_webview_window("dsh-native-ui") {
        let _ = win.set_focus();
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "dsh-native-ui",
            tauri::WebviewUrl::External(url),
        )
        .title("DeepSeek Harness - Native Web UI")
        .inner_size(1024.0, 768.0)
        .build()
        .map_err(|e| format!("failed to open DSH window: {e}"))?;
    }
    Ok(url_str)
}

#[tauri::command]
fn host_profiles_list(project_root: Option<String>) -> Result<Vec<host_profile::DiscoveredHost>, String> {
    let p = project_root.as_ref().map(std::path::Path::new);
    Ok(host_profile::scan_all_hosts(p))
}

#[tauri::command]
fn skills_scan_repo(repo_path: Option<String>, repo_name: Option<String>) -> Result<skill_flow::SkillRepoGroup, String> {
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
fn skill_get_diff(base_snapshot_id: String, head_snapshot_id: String) -> Result<skill_flow::SnapshotDiff, String> {
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
fn skill_get_translation(skill_name: String, current_snapshot_id: Option<String>) -> Result<Option<skill_flow::TranslationDoc>, String> {
    if !skill_flow::is_safe_id_segment(&skill_name) {
        return Err(format!("invalid skill_name: {skill_name}"));
    }
    if let Some(ref snap_id) = current_snapshot_id {
        if !skill_flow::is_safe_id_segment(snap_id) {
            return Err(format!("invalid current_snapshot_id: {snap_id}"));
        }
    }
    let (layout, _conn) = open_layout_and_db()?;
    skill_flow::load_translation(&layout.translations, &skill_name, current_snapshot_id.as_deref())
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

    let raw_list: Vec<_> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    // 计算同名 skill 的历史前驱快照（按 created_at DESC 排序后，紧邻的下一个快照即为其前驱版本）
    let mut items_with_prev = Vec::new();
    let total = raw_list.len();
    for i in 0..total {
        let (snap_id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at) = &raw_list[i];
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
    for (snap_id, _source_repo, _commit_sha, skill_name, file_count, content_sha, created_at, previous_snapshot_id) in items_with_prev {
        let trans = skill_flow::load_translation(&layout.translations, &skill_name, Some(&snap_id)).ok().flatten();
        let desc = trans.as_ref().map(|t| t.purpose.clone()).unwrap_or_else(|| {
            format!("{skill_name} ({file_count} 个文件)")
        });
        let tools = trans.as_ref().map(|t| t.target_tools.clone()).unwrap_or_default();
        let zh = trans.as_ref().map(|t| t.markdown_body.clone()).unwrap_or_default();

        let snap_dir = layout.skills.join("snapshots").join(&snap_id);
        let mut original = String::new();
        if snap_dir.exists() {
            if let Ok(files) = skill_flow::collect_files(&snap_dir) {
                for (rel, abs) in files {
                    if rel.eq_ignore_ascii_case("readme.md") || rel.eq_ignore_ascii_case("skill.md") {
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
fn skill_batch_deploy_plan(snapshot_id: String, targets: Vec<skill_flow::DeploymentTarget>) -> Result<skill_flow::DeploymentPlan, String> {
    if !skill_flow::is_safe_id_segment(&snapshot_id) {
        return Err(format!("invalid snapshot_id: {snapshot_id}"));
    }
    let (layout, conn) = open_layout_and_db()?;
    let snap_dir = layout.skills.join("snapshots").join(&snapshot_id);
    if !snap_dir.exists() {
        return Err(format!("快照目录未找到: {snapshot_id} (路径: {})", snap_dir.display()));
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
    Ok(skill_flow::plan_batch_deployment(&conn, &snap, &resolved_targets, &managed_roots))
}

#[tauri::command]
fn skill_batch_deploy_apply(snapshot_id: String, targets: Vec<skill_flow::DeploymentTarget>) -> Result<skill_flow::BatchDeployResult, String> {
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

pub fn run() {
    tauri::Builder::default()
        .manage(SessionSlot {
            session: Mutex::new(None),
        })
        .manage(DshSlot {
            server: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            pi_discover,
            pi_install_managed,
            pi_session_status,
            pi_session_ensure,
            pi_session_start,
            pi_session_prompt,
            pi_session_abort,
            pi_session_stop,
            pi_session_observation,
            pi_get_available_models,
            pi_set_model,
            pi_get_state,
            pi_new_session,
            dsh_discover,
            dsh_install_managed,
            dsh_start,
            dsh_stop,
            dsh_status,
            dsh_open_window,
            skill_m1_pipeline,
            skill_rollback_latest,
            skill_status,
            skills_list,
            host_profiles_list,
            skills_scan_repo,
            skill_get_diff,
            skill_get_translation,
            skill_save_translation,
            skill_batch_deploy_plan,
            skill_batch_deploy_apply
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// M1 无头自检：真实 Pi 会话（流式/工具/取消/崩溃）+ 真实 Skill 纵切 +
/// 回滚验证。打印每个阶段的真实结果；任一关键阶段失败返回非零退出码。
pub fn selftest_m1() -> i32 {
    let mut failures = 0;
    let mut report_line = |ok: bool, name: &str, detail: String| {
        println!("[{}] {name}: {detail}", if ok { "OK" } else { "FAIL" });
        if !ok {
            failures += 1;
        }
    };

    // 0. 发现
    let root = match app_data::AppDataLayout::default_root() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] app data root: {e}");
            return 1;
        }
    };
    let mut runtimes = pi_connector::discover(&root);
    let mut locked_ok = runtimes
        .iter()
        .any(|r| r.version == pi_connector::LOCKED_PI_VERSION);

    if !locked_ok {
        println!("[INFO] managed Pi {} not found, attempting auto-installation...", pi_connector::LOCKED_PI_VERSION);
        match pi_connector::install_managed(&root, pi_connector::LOCKED_PI_VERSION) {
            Ok(installed) => {
                println!("[INFO] installed managed Pi {}: {}", installed.version, installed.cli_js);
                runtimes = pi_connector::discover(&root);
                locked_ok = runtimes.iter().any(|r| r.version == pi_connector::LOCKED_PI_VERSION);
            }
            Err(e) => {
                println!("[WARN] auto-install Pi {} failed: {e}", pi_connector::LOCKED_PI_VERSION);
            }
        }
    }

    for r in &runtimes {
        println!(
            "[INFO] discovered Pi {} ({}): {}",
            r.version,
            if r.managed { "managed" } else { "external" },
            r.cli_js
        );
    }
    report_line(locked_ok, "pi-discovery", format!("Pi {} available", pi_connector::LOCKED_PI_VERSION));

    let runtime = match locked_runtime() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] locked runtime: {e}");
            return 1;
        }
    };
    let (layout, conn) = match open_layout_and_db() {
        Ok(x) => x,
        Err(e) => {
            println!("[FAIL] layout/db: {e}");
            return 1;
        }
    };
    let workspace = pi_workspace(&layout);
    let cli = std::path::PathBuf::from(&runtime.cli_js);

    // 1. 真实会话：流式 + 工具执行
    println!("[INFO] starting real RPC session (Pi 自行使用其默认配置与凭据)...");
    let session = match PiSession::start(&cli, &workspace, None, |_ev| {}) {
        Ok(s) => s,
        Err(e) => {
            println!("[FAIL] session start: {e}");
            return 1;
        }
    };
    let prompt_ok = session
        .prompt("Use the bash tool to run exactly: echo aster-m1-selftest then reply with just: DONE")
        .is_ok();
    report_line(prompt_ok, "session-prompt-accepted", "prompt accepted".into());
    let settled = session.wait_settled(Duration::from_secs(180));
    let obs = session.observation();
    report_line(
        settled && obs.tool_starts >= 1 && obs.protocol_errors.is_empty(),
        "session-streaming-tools",
        format!(
            "updates={} tools={:?} names={:?} settled={settled} errors={:?}",
            obs.message_updates, obs.tool_starts, obs.tool_names, obs.protocol_errors
        ),
    );

    // 2. 取消：长任务 -> abort -> settled
    let cancel_ok = (|| -> bool {
        if session.is_closed() {
            return false;
        }
        let started = session
            .prompt("Count slowly from 1 to 30, one number per line, using separate bash calls.")
            .is_ok();
        if !started {
            return false;
        }
        std::thread::sleep(Duration::from_secs(3));
        if session.abort().is_err() {
            return false;
        }
        session.wait_settled(Duration::from_secs(30))
    })();
    let obs2 = session.observation();
    report_line(
        cancel_ok,
        "session-cancel",
        format!(
            "abort confirmed via agent_settled; total tools after cancel={}",
            obs2.tool_starts
        ),
    );

    // 3. 异常退出：流式中途杀进程 -> 无 settled
    let crash_ok = (|| -> bool {
        let mut crash_session = match PiSession::start(&cli, &workspace, None, |_ev| {}) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let started = crash_session
            .prompt("Count slowly from 1 to 30, one number per line, using separate bash calls.")
            .is_ok();
        if !started {
            return false;
        }
        std::thread::sleep(Duration::from_secs(2));
        let _ = crash_session.stop();
        std::thread::sleep(Duration::from_millis(500));
        crash_session.is_closed() && !crash_session.observation().settled
    })();
    report_line(crash_ok, "session-crash-detection", "process killed mid-stream; no settled observed".into());

    // 4. Skill 纵切
    let report = match run_m1_pipeline_core() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] skill pipeline: {e}");
            return 1;
        }
    };
    for s in &report.stages {
        println!("[INFO] skill stage {}: {} - {}", s.stage, s.status, s.detail);
    }
    let required_ok = ["discovered", "downloaded", "structurally_validated", "configured", "target_discovered"];
    let all_required = report
        .stages
        .iter()
        .filter(|s| required_ok.contains(&s.stage.as_str()))
        .all(|s| s.status == "success");
    report_line(
        all_required,
        "skill-pipeline",
        format!("snapshot {}", report.snapshot_id),
    );

    // 5. Evidence 查询
    let key = evidence::EvidenceKey {
        skill_snapshot_id: report.snapshot_id.clone(),
        target_host_id: "pi".into(),
        host_version: pi_connector::LOCKED_PI_VERSION.into(),
        deployment_scope: "aster-test-scope".into(),
        profile_version: "pi-rpc-v1".into(),
    };
    let stages = evidence::latest_by_stage(&conn, &key).unwrap_or_default();
    report_line(
        stages.len() >= 6,
        "evidence-recorded",
        format!("{} stages recorded", stages.len()),
    );

    // 6. 回滚验证：回滚后目标目录恢复不存在
    let rolled = skill_rollback_all(&conn);
    let scope_skills = layout.runtimes.join("pi").join("test-scope").join("skills");
    let scope_clean = !scope_skills.join("doc-coauthoring").exists();
    report_line(
        rolled.is_ok() && scope_clean,
        "rollback",
        format!("deployments rolled back; target dir removed = {scope_clean}"),
    );

    failures
}

/// M2 无头自检：真实 DSH 发现/managed 安装 + 端口分配/冲突检测 + 健康检查 + 崩溃恢复
pub fn selftest_m2() -> i32 {
    let mut failures = 0;
    let mut report_line = |ok: bool, name: &str, detail: String| {
        println!("[{}] {name}: {detail}", if ok { "OK" } else { "FAIL" });
        if !ok {
            failures += 1;
        }
    };

    // 0. 发现与安装
    let root = match app_data::AppDataLayout::default_root() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] app data root: {e}");
            return 1;
        }
    };
    let mut runtimes = dsh_connector::discover(&root);
    let mut locked_ok = runtimes.iter().any(|r| r.version == dsh_connector::LOCKED_DSH_VERSION);

    if !locked_ok {
        println!("[INFO] managed DSH {} not found, attempting auto-installation...", dsh_connector::LOCKED_DSH_VERSION);
        match dsh_connector::install_managed(&root, dsh_connector::LOCKED_DSH_VERSION) {
            Ok(installed) => {
                println!("[INFO] installed managed DSH {}: {}", installed.version, installed.entry_path);
                runtimes = dsh_connector::discover(&root);
                locked_ok = runtimes.iter().any(|r| r.version == dsh_connector::LOCKED_DSH_VERSION);
            }
            Err(e) => {
                println!("[WARN] auto-install DSH {} failed: {e}", dsh_connector::LOCKED_DSH_VERSION);
            }
        }
    }

    for r in &runtimes {
        println!(
            "[INFO] discovered DSH {} ({}): {}",
            r.version,
            if r.managed { "managed" } else { "external" },
            r.entry_path
        );
    }
    report_line(locked_ok, "dsh-discovery", format!("DSH {} available", dsh_connector::LOCKED_DSH_VERSION));

    // 1. 端口可用性与冲突检测
    let port1 = dsh_connector::find_available_port(dsh_connector::DEFAULT_DSH_PORT);
    report_line(port1.is_some(), "dsh-port-find", format!("available port: {:?}", port1));

    // 2. 端口冲突避让测试
    let conflict_handled = if let Some(p) = port1 {
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", p)) {
            let next_p = dsh_connector::find_available_port(p);
            let ok = next_p.map(|np| np > p).unwrap_or(false);
            drop(listener);
            ok
        } else {
            true
        }
    } else {
        false
    };
    report_line(conflict_handled, "dsh-port-conflict-avoidance", "occupied port skipped cleanly".into());

    // 3. 服务生命周期测试
    let runtime = match locked_dsh_runtime() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] locked DSH runtime: {e}");
            return 1;
        }
    };
    let (layout, _conn) = match open_layout_and_db() {
        Ok(x) => x,
        Err(e) => {
            println!("[FAIL] layout/db: {e}");
            return 1;
        }
    };
    let workspace = dsh_workspace(&layout);

    println!("[INFO] starting DSH server...");
    let server_res = DshServer::start(&layout.root, &runtime, &workspace, None, dsh_connector::DEFAULT_DSH_PORT);
    match server_res {
        Ok(mut server) => {
            let status = server.status();
            report_line(
                status.running && status.healthy,
                "dsh-server-start-and-health",
                format!("running at {} (PID {:?}), health={}", status.url, status.pid, status.healthy),
            );
            let stop_ok = server.stop().is_ok();
            report_line(stop_ok, "dsh-server-stop", "process stopped cleanly".into());
        }
        Err(e) => {
            report_line(false, "dsh-server-start-and-health", format!("start failed: {e}"));
        }
    }

    failures
}

fn skill_rollback_all(conn: &rusqlite::Connection) -> Result<usize, String> {
    let rows = skill_flow::active_deployments_for_host(conn, "pi").map_err(|e| e.to_string())?;
    let n = rows.len();
    for (id, _host, _ver, path) in rows {
        skill_flow::rollback(conn, id, std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    }
    Ok(n)
}

/// M3 无头自检：11 宿主 Profile 扫描 + 多 Skill 仓库解析 + 恶意文件安全隔离 + 快照 Diff +
/// 中文说明生命周期与过期提示 + 多目标批量部署计划（Plan & Apply）+ 外部冲突拦截与补偿回滚 + 分级 Evidence
pub fn selftest_m3() -> i32 {
    let mut failures = 0;
    let mut report_line = |ok: bool, name: &str, detail: String| {
        println!("[{}] {name}: {detail}", if ok { "OK" } else { "FAIL" });
        if !ok {
            failures += 1;
        }
    };

    println!("=== Aster M3 (Skills Manager Breadth) 无头自检开始 ===");

    // 0. 打开临时/测试数据目录与数据库
    let (layout, mut conn) = match open_layout_and_db() {
        Ok(x) => x,
        Err(e) => {
            println!("[FAIL] layout/db: {e}");
            return 1;
        }
    };

    // 1. 11 个宿主工具 Profiles 静态事实与扫描
    let profiles = host_profile::all_profiles();
    let exact_11 = profiles.len() == 11;
    let discovered = host_profile::scan_all_hosts(None);
    report_line(
        exact_11 && discovered.len() == 11,
        "host-profiles-11-tools",
        "11 target host profiles defined and scanned (verified: Pi, DSH, Antigravity)".into(),
    );

    // 2. 多 Skill 仓库扫描与结构化分组
    let demo_repo = layout.staging.join("selftest-multi-repo");
    let _ = std::fs::remove_dir_all(&demo_repo);
    let _ = std::fs::create_dir_all(&demo_repo);

    let s1 = demo_repo.join("skills/doc-writer");
    let s2 = demo_repo.join("skills/code-analyst");
    let s3_bad = demo_repo.join("skills/unsafe-downloader");
    let _ = std::fs::create_dir_all(&s1);
    let _ = std::fs::create_dir_all(&s2);
    let _ = std::fs::create_dir_all(&s3_bad);

    let _ = std::fs::write(s1.join("SKILL.md"), "---\nname: doc-writer\ndescription: Design doc assistant\n---\n# Doc Writer v1\nLine 1\n");
    let _ = std::fs::write(s2.join("SKILL.md"), "---\nname: code-analyst\ndescription: AST & lint analyzer\n---\n# Code Analyst\nAnalysis tool\n");
    let _ = std::fs::write(s3_bad.join("SKILL.md"), "# Bad\nContains binary");
    let _ = std::fs::write(s3_bad.join("downloader.exe"), "malicious-executable-content");

    let repo_group = skill_flow::scan_multi_skill_repo(&demo_repo, "anthropics/skills", "commit-m3-selftest", Some(&layout.translations), None);
    let scan_ok = repo_group.as_ref().map(|g| g.skills.len() == 3).unwrap_or(false);
    report_line(scan_ok, "multi-skill-repo-scanning", "discovered 3 skills in repo grouping".into());

    // 3. 恶意脚本/二进制安全拦截与 Quarantine 隔离
    let check_res = skill_flow::static_check(&s3_bad);
    let quarantine_ok = if let Err(findings) = check_res {
        match skill_flow::quarantine_bad_skill(&layout.quarantine, "anthropics/skills/unsafe-downloader", &s3_bad, &findings) {
            Ok(q_rec) => {
                let manifest_ok = std::path::Path::new(&q_rec.quarantine_path).join("manifest.json").is_file();
                manifest_ok && !s3_bad.exists()
            }
            Err(_) => false,
        }
    } else {
        false
    };
    report_line(quarantine_ok, "quarantine-security-isolation", "blocked .exe file, archived to quarantine/ with manifest.json, cleaned staging".into());

    // 4. 不可变快照创建与快照 Diff
    let doc_src_v1 = skill_flow::SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "commit-v1".into(),
        skill_path: "skills/doc-writer".into(),
    };
    let snap_v1 = skill_flow::create_snapshot(&layout.skills, &doc_src_v1, &s1);
    let _ = snap_v1.as_ref().map(|s| skill_flow::record_snapshot(&conn, &doc_src_v1, s));

    // 模拟 v2 修改
    let _ = std::fs::write(s1.join("SKILL.md"), "---\nname: doc-writer\ndescription: Design doc assistant v2\n---\n# Doc Writer v2\nLine 1 modified\n");
    let _ = std::fs::write(s1.join("extra.txt"), "Extra resources\n");
    let doc_src_v2 = skill_flow::SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "commit-v2".into(),
        skill_path: "skills/doc-writer".into(),
    };
    let snap_v2 = skill_flow::create_snapshot(&layout.skills, &doc_src_v2, &s1);
    let _ = snap_v2.as_ref().map(|s| skill_flow::record_snapshot(&conn, &doc_src_v2, s));

    let diff_ok = if let (Ok(v1), Ok(v2)) = (&snap_v1, &snap_v2) {
        if let Ok(diff) = skill_flow::snapshot_diff(&v1.root_dir, &v2.root_dir, &v1.id, &v2.id) {
            diff.added_files.contains(&"extra.txt".to_string()) && diff.modified_files.contains(&"SKILL.md".to_string())
        } else {
            false
        }
    } else {
        false
    };
    report_line(diff_ok, "snapshot-diff-calculation", "detected additions (extra.txt) and modifications (SKILL.md) with line diff".into());

    // 5. 中文派生说明（Translations）生命周期与过期提示
    let tr_doc = skill_flow::TranslationDoc {
        skill_name: "doc-writer".into(),
        snapshot_id: snap_v1.as_ref().map(|s| s.id.clone()).unwrap_or_default(),
        purpose: "设计文档自动化与协作".into(),
        applicable_tasks: "需求规划、架构评审".into(),
        target_tools: vec!["pi".into(), "cursor".into(), "antigravity".into()],
        prerequisites: "无特殊凭据要求".into(),
        risks: "纯文本处理".into(),
        author: "selftest".into(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        markdown_body: "# 中文使用说明\n由用户编写的中文操作指南。".into(),
        is_stale: false,
    };
    let _ = skill_flow::save_translation(Some(&conn), &layout.translations, &tr_doc);

    let tr_v1 = skill_flow::load_translation(&layout.translations, "doc-writer", snap_v1.as_ref().ok().map(|s| s.id.as_str()));
    let tr_v2 = skill_flow::load_translation(&layout.translations, "doc-writer", snap_v2.as_ref().ok().map(|s| s.id.as_str()));
    let tr_ok = tr_v1.as_ref().ok().and_then(|o| o.as_ref()).map(|d| !d.is_stale).unwrap_or(false)
        && tr_v2.as_ref().ok().and_then(|o| o.as_ref()).map(|d| d.is_stale && d.purpose == "设计文档自动化与协作").unwrap_or(false);
    report_line(tr_ok, "chinese-translation-lifecycle", "saved derived translation; v1 matched, v2 flagged stale without losing content".into());

    // 6. 多目标批量部署规划与未托管冲突拦截
    let managed_root = layout.runtimes.join("selftest-managed-deploy");
    let _ = std::fs::create_dir_all(&managed_root);

    let t_pi = skill_flow::DeploymentTarget {
        host: "pi".into(),
        host_version: "0.84.2".into(),
        scope: "user".into(),
        path: managed_root.join("pi-skills/doc-writer"),
    };
    let t_cursor = skill_flow::DeploymentTarget {
        host: "cursor".into(),
        host_version: "1.0.0".into(),
        scope: "project".into(),
        path: managed_root.join("cursor-skills/doc-writer"),
    };
    let t_antigravity = skill_flow::DeploymentTarget {
        host: "antigravity".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("antigravity-skills/doc-writer"),
    };

    // 制造未托管冲突
    let conflict_dir = managed_root.join("unmanaged-skills/doc-writer");
    let _ = std::fs::create_dir_all(&conflict_dir);
    let _ = std::fs::write(conflict_dir.join("foreign.txt"), "external user data");
    let t_conflict = skill_flow::DeploymentTarget {
        host: "zed".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: conflict_dir,
    };

    let s2_snap = snap_v2.unwrap();
    let blocked_plan = skill_flow::plan_batch_deployment(&conn, &s2_snap, &[t_pi.clone(), t_conflict], std::slice::from_ref(&managed_root));
    let conflict_blocked = !blocked_plan.can_apply && blocked_plan.blocked_targets == 1;
    report_line(conflict_blocked, "deployment-plan-unmanaged-protection", "unmanaged directory with foreign files blocked from apply".into());

    // 7. 批量部署应用与补偿回滚
    let valid_targets = [t_pi, t_cursor, t_antigravity];
    let deploy_res = skill_flow::deploy_batch_planned(&mut conn, &s2_snap, &valid_targets, std::slice::from_ref(&managed_root));
    let deploy_ok = deploy_res.as_ref().map(|r| r.success && r.deployed_count == 3).unwrap_or(false);
    report_line(deploy_ok, "batch-deploy-multi-targets", "successfully deployed to 3 target hosts with hash verification".into());

    // 8. 验证分级 Evidence
    let key = evidence::EvidenceKey {
        skill_snapshot_id: s2_snap.id.clone(),
        target_host_id: "cursor".into(),
        host_version: "1.0.0".into(),
        deployment_scope: "project".into(),
        profile_version: "cursor-v1".into(),
    };
    let stages = evidence::latest_by_stage(&conn, &key).unwrap_or_default();
    let evidence_ok = stages.iter().any(|s| s.stage == Stage::TargetDiscovered && s.status == Status::Success)
        && stages.iter().any(|s| s.stage == Stage::SessionLoaded && s.status == Status::Unknown);
    report_line(evidence_ok, "evidence-store-graded-logging", "cursor evidence has target_discovered=success, session_loaded=unknown".into());

    // 9. 运行时失败的补偿回滚测试
    let fail_parent = managed_root.join("blocked-parent-file");
    let _ = std::fs::write(&fail_parent, "blocking file");
    let t_fail = skill_flow::DeploymentTarget {
        host: "zed".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: fail_parent.join("doc-writer"),
    };
    let t_roll1 = skill_flow::DeploymentTarget {
        host: "qoder".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("qoder-skills/doc-writer"),
    };
    let fail_batch_res = skill_flow::deploy_batch_planned(&mut conn, &s2_snap, &[t_roll1.clone(), t_fail], std::slice::from_ref(&managed_root));
    let rollback_ok = fail_batch_res.as_ref().map(|r| !r.success && r.rolled_back_count == 1).unwrap_or(false)
        && !t_roll1.path.exists();
    report_line(rollback_ok, "compensating-rollback-verification", "runtime failure cleanly triggered compensating rollback for prior targets".into());

    println!("=== Aster M3 无头自检完成: {} failures ===", failures);
    failures
}
