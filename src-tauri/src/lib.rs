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
use evidence::{Stage, Status};
use pi_connector::{PiLaunchOptions, PiRuntime, PiSession, SessionEvent};
use pi_runtime::{
    decide_activate_project, decide_remove_project, ActivateProjectDecision, PiEventEnvelope,
    PiEventSink, PiRuntimeManager,
};
use serde::{Deserialize, Serialize};
use skill_flow::M1_SKILL_SOURCE;
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
        &PiLaunchOptions::default(),
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
    let ok = resp
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        return Err(format!("get_commands failed: {resp}"));
    }
    let scope_str = scope_dir.to_string_lossy().to_lowercase();
    let mut matched = Vec::new();
    if let Some(commands) = resp
        .get("data")
        .and_then(|d| d.get("commands"))
        .and_then(|c| c.as_array())
    {
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
    let workspace = pi_workspace(&layout, Some(&conn));
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
            stages.push(M1StageReport {
                stage: "downloaded".into(),
                status: "failure".into(),
                detail: e.clone(),
            });
            results.insert(Stage::Downloaded, evidence::Status::Failure);
            skill_flow::record_evidence_chain(
                &conn,
                &pending_snapshot_id(&M1_SKILL_SOURCE),
                "pi",
                pi_connector::LOCKED_PI_VERSION,
                "aster-test-scope",
                &results,
            )
            .map_err(|e| e.to_string())?;
            return Ok(M1PipelineReport {
                snapshot_id: pending_snapshot_id(&M1_SKILL_SOURCE),
                stages,
                deployment_id: None,
            });
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
            stages.push(M1StageReport {
                stage: "structurally_validated".into(),
                status: "failure".into(),
                detail,
            });
            results.insert(Stage::StructurallyValidated, evidence::Status::Failure);
            let snap_id = pending_snapshot_id(&M1_SKILL_SOURCE);
            skill_flow::record_evidence_chain(
                &conn,
                &snap_id,
                "pi",
                pi_connector::LOCKED_PI_VERSION,
                "aster-test-scope",
                &results,
            )
            .map_err(|e| e.to_string())?;
            return Ok(M1PipelineReport {
                snapshot_id: snap_id,
                stages,
                deployment_id: None,
            });
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
            stages.push(M1StageReport {
                stage: "configured".into(),
                status: "failure".into(),
                detail: e.clone(),
            });
            results.insert(Stage::Configured, evidence::Status::Failure);
            skill_flow::record_evidence_chain(
                &conn,
                &snap.id,
                "pi",
                pi_connector::LOCKED_PI_VERSION,
                "aster-test-scope",
                &results,
            )
            .map_err(|e| e.to_string())?;
            return Ok(M1PipelineReport {
                snapshot_id: snap.id,
                stages,
                deployment_id: None,
            });
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
            stages.push(M1StageReport {
                stage: "target_discovered".into(),
                status: "failure".into(),
                detail: e.clone(),
            });
            results.insert(Stage::TargetDiscovered, evidence::Status::Failure);
        }
    }

    // 6. session_loaded / callable_verified：诚实记录 unknown 与原因
    stages.push(M1StageReport {
        stage: "session_loaded".into(),
        status: "unknown".into(),
        detail: "test scope has no host credentials by design; Aster does not migrate credentials"
            .into(),
    });
    results.insert(Stage::SessionLoaded, evidence::Status::Unknown);
    stages.push(M1StageReport {
        stage: "callable_verified".into(),
        status: "unknown".into(),
        detail: "requires an authenticated scoped session; not attempted in M1".into(),
    });
    results.insert(Stage::CallableVerified, evidence::Status::Unknown);

    skill_flow::record_evidence_chain(
        &conn,
        &snap.id,
        "pi",
        pi_connector::LOCKED_PI_VERSION,
        "aster-test-scope",
        &results,
    )
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
    Ok(SkillRollbackReport {
        rolled_back: rolled,
    })
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
            skill_m1_pipeline,
            skill_rollback_latest,
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
        println!(
            "[INFO] managed Pi {} not found, attempting auto-installation...",
            pi_connector::LOCKED_PI_VERSION
        );
        match pi_connector::install_managed(&root, pi_connector::LOCKED_PI_VERSION) {
            Ok(installed) => {
                println!(
                    "[INFO] installed managed Pi {}: {}",
                    installed.version, installed.cli_js
                );
                runtimes = pi_connector::discover(&root);
                locked_ok = runtimes
                    .iter()
                    .any(|r| r.version == pi_connector::LOCKED_PI_VERSION);
            }
            Err(e) => {
                println!(
                    "[WARN] auto-install Pi {} failed: {e}",
                    pi_connector::LOCKED_PI_VERSION
                );
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
    report_line(
        locked_ok,
        "pi-discovery",
        format!("Pi {} available", pi_connector::LOCKED_PI_VERSION),
    );

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
    let workspace = pi_workspace(&layout, Some(&conn));
    let cli = std::path::PathBuf::from(&runtime.cli_js);

    // 1. 真实会话：流式 + 工具执行
    println!("[INFO] starting real RPC session (Pi 自行使用其默认配置与凭据)...");
    let session = match PiSession::start(
        &cli,
        &workspace,
        None,
        &PiLaunchOptions::default(),
        |_ev| {},
    ) {
        Ok(s) => s,
        Err(e) => {
            println!("[FAIL] session start: {e}");
            return 1;
        }
    };
    let prompt_ok = session
        .prompt(
            "Use the bash tool to run exactly: echo aster-m1-selftest then reply with just: DONE",
        )
        .is_ok();
    report_line(
        prompt_ok,
        "session-prompt-accepted",
        "prompt accepted".into(),
    );
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
        let mut crash_session = match PiSession::start(
            &cli,
            &workspace,
            None,
            &PiLaunchOptions::default(),
            |_ev| {},
        ) {
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
    report_line(
        crash_ok,
        "session-crash-detection",
        "process killed mid-stream; no settled observed".into(),
    );

    // 4. Skill 纵切
    let report = match run_m1_pipeline_core() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] skill pipeline: {e}");
            return 1;
        }
    };
    for s in &report.stages {
        println!(
            "[INFO] skill stage {}: {} - {}",
            s.stage, s.status, s.detail
        );
    }
    let required_ok = [
        "discovered",
        "downloaded",
        "structurally_validated",
        "configured",
        "target_discovered",
    ];
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
    let mut locked_ok = runtimes
        .iter()
        .any(|r| r.version == dsh_connector::LOCKED_DSH_VERSION);

    if !locked_ok {
        println!(
            "[INFO] managed DSH {} not found, attempting auto-installation...",
            dsh_connector::LOCKED_DSH_VERSION
        );
        match dsh_connector::install_managed(&root, dsh_connector::LOCKED_DSH_VERSION) {
            Ok(installed) => {
                println!(
                    "[INFO] installed managed DSH {}: {}",
                    installed.version, installed.entry_path
                );
                runtimes = dsh_connector::discover(&root);
                locked_ok = runtimes
                    .iter()
                    .any(|r| r.version == dsh_connector::LOCKED_DSH_VERSION);
            }
            Err(e) => {
                println!(
                    "[WARN] auto-install DSH {} failed: {e}",
                    dsh_connector::LOCKED_DSH_VERSION
                );
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
    report_line(
        locked_ok,
        "dsh-discovery",
        format!("DSH {} available", dsh_connector::LOCKED_DSH_VERSION),
    );

    // 1. 端口可用性与冲突检测
    let port1 = dsh_connector::find_available_port(dsh_connector::DEFAULT_DSH_PORT);
    report_line(
        port1.is_some(),
        "dsh-port-find",
        format!("available port: {:?}", port1),
    );

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
    report_line(
        conflict_handled,
        "dsh-port-conflict-avoidance",
        "occupied port skipped cleanly".into(),
    );

    // 3. 服务生命周期测试
    let runtime = match locked_dsh_runtime() {
        Ok(r) => r,
        Err(e) => {
            println!("[FAIL] locked DSH runtime: {e}");
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
    let workspace = dsh_workspace(&layout, Some(&conn));

    println!("[INFO] starting DSH server...");
    let server_res = DshServer::start(
        &layout.root,
        &runtime,
        &workspace,
        "127.0.0.1",
        dsh_connector::DEFAULT_DSH_PORT,
    );
    match server_res {
        Ok(mut server) => {
            let status = server.status();
            report_line(
                status.running && status.healthy,
                "dsh-server-start-and-health",
                format!(
                    "running at {} (PID {:?}), health={}",
                    status.url, status.pid, status.healthy
                ),
            );
            let stop_ok = server.stop().is_ok();
            report_line(stop_ok, "dsh-server-stop", "process stopped cleanly".into());
        }
        Err(e) => {
            report_line(
                false,
                "dsh-server-start-and-health",
                format!("start failed: {e}"),
            );
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

    let _ = std::fs::write(
        s1.join("SKILL.md"),
        "---\nname: doc-writer\ndescription: Design doc assistant\n---\n# Doc Writer v1\nLine 1\n",
    );
    let _ = std::fs::write(s2.join("SKILL.md"), "---\nname: code-analyst\ndescription: AST & lint analyzer\n---\n# Code Analyst\nAnalysis tool\n");
    let _ = std::fs::write(s3_bad.join("SKILL.md"), "# Bad\nContains binary");
    let _ = std::fs::write(
        s3_bad.join("downloader.exe"),
        "malicious-executable-content",
    );

    let repo_group = skill_flow::scan_multi_skill_repo(
        &demo_repo,
        "anthropics/skills",
        "commit-m3-selftest",
        Some(&layout.translations),
        None,
    );
    let scan_ok = repo_group
        .as_ref()
        .map(|g| g.skills.len() == 3)
        .unwrap_or(false);
    report_line(
        scan_ok,
        "multi-skill-repo-scanning",
        "discovered 3 skills in repo grouping".into(),
    );

    // 3. 恶意脚本/二进制安全拦截与 Quarantine 隔离
    let check_res = skill_flow::static_check(&s3_bad);
    let quarantine_ok = if let Err(findings) = check_res {
        match skill_flow::quarantine_bad_skill(
            &layout.quarantine,
            "anthropics/skills/unsafe-downloader",
            &s3_bad,
            &findings,
        ) {
            Ok(q_rec) => {
                let manifest_ok = std::path::Path::new(&q_rec.quarantine_path)
                    .join("manifest.json")
                    .is_file();
                // quarantine_bad_skill 只写文件系统；读取端 list_quarantine_items 只查 DB，
                // 必须在这里把记录桥接进 DB，否则隔离区 UI 看不到该样本。
                let db_ok = crate::db::insert_quarantine_record(
                    &conn,
                    &q_rec.quarantine_id,
                    &q_rec.source_info,
                    &q_rec.reason,
                    &q_rec.quarantine_path,
                    &q_rec.quarantined_at,
                )
                .is_ok();
                manifest_ok && db_ok && !s3_bad.exists()
            }
            Err(_) => false,
        }
    } else {
        false
    };
    report_line(
        quarantine_ok,
        "quarantine-security-isolation",
        "blocked .exe file, archived to quarantine/ with manifest.json, cleaned staging".into(),
    );

    // 4. 不可变快照创建与快照 Diff
    let doc_src_v1 = skill_flow::SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "commit-v1".into(),
        skill_path: "skills/doc-writer".into(),
    };
    let snap_v1 = skill_flow::create_snapshot(&layout.skills, &doc_src_v1, &s1);
    let _ = snap_v1
        .as_ref()
        .map(|s| skill_flow::record_snapshot(&conn, &doc_src_v1, s));

    // 模拟 v2 修改
    let _ = std::fs::write(s1.join("SKILL.md"), "---\nname: doc-writer\ndescription: Design doc assistant v2\n---\n# Doc Writer v2\nLine 1 modified\n");
    let _ = std::fs::write(s1.join("extra.txt"), "Extra resources\n");
    let doc_src_v2 = skill_flow::SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "commit-v2".into(),
        skill_path: "skills/doc-writer".into(),
    };
    let snap_v2 = skill_flow::create_snapshot(&layout.skills, &doc_src_v2, &s1);
    let _ = snap_v2
        .as_ref()
        .map(|s| skill_flow::record_snapshot(&conn, &doc_src_v2, s));

    let diff_ok = if let (Ok(v1), Ok(v2)) = (&snap_v1, &snap_v2) {
        if let Ok(diff) = skill_flow::snapshot_diff(&v1.root_dir, &v2.root_dir, &v1.id, &v2.id) {
            diff.added_files.contains(&"extra.txt".to_string())
                && diff.modified_files.contains(&"SKILL.md".to_string())
        } else {
            false
        }
    } else {
        false
    };
    report_line(
        diff_ok,
        "snapshot-diff-calculation",
        "detected additions (extra.txt) and modifications (SKILL.md) with line diff".into(),
    );

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

    let tr_v1 = skill_flow::load_translation(
        &layout.translations,
        "doc-writer",
        snap_v1.as_ref().ok().map(|s| s.id.as_str()),
    );
    let tr_v2 = skill_flow::load_translation(
        &layout.translations,
        "doc-writer",
        snap_v2.as_ref().ok().map(|s| s.id.as_str()),
    );
    let tr_ok = tr_v1
        .as_ref()
        .ok()
        .and_then(|o| o.as_ref())
        .map(|d| !d.is_stale)
        .unwrap_or(false)
        && tr_v2
            .as_ref()
            .ok()
            .and_then(|o| o.as_ref())
            .map(|d| d.is_stale && d.purpose == "设计文档自动化与协作")
            .unwrap_or(false);
    report_line(
        tr_ok,
        "chinese-translation-lifecycle",
        "saved derived translation; v1 matched, v2 flagged stale without losing content".into(),
    );

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
    let blocked_plan = skill_flow::plan_batch_deployment(
        &conn,
        &s2_snap,
        &[t_pi.clone(), t_conflict],
        std::slice::from_ref(&managed_root),
    );
    let conflict_blocked = !blocked_plan.can_apply && blocked_plan.blocked_targets == 1;
    report_line(
        conflict_blocked,
        "deployment-plan-unmanaged-protection",
        "unmanaged directory with foreign files blocked from apply".into(),
    );

    // 7. 批量部署应用与补偿回滚
    let valid_targets = [t_pi, t_cursor, t_antigravity];
    let deploy_res = skill_flow::deploy_batch_planned(
        &mut conn,
        &s2_snap,
        &valid_targets,
        std::slice::from_ref(&managed_root),
    );
    let deploy_ok = deploy_res
        .as_ref()
        .map(|r| r.success && r.deployed_count == 3)
        .unwrap_or(false);
    report_line(
        deploy_ok,
        "batch-deploy-multi-targets",
        "successfully deployed to 3 target hosts with hash verification".into(),
    );

    // 8. 验证分级 Evidence
    let key = evidence::EvidenceKey {
        skill_snapshot_id: s2_snap.id.clone(),
        target_host_id: "cursor".into(),
        host_version: "1.0.0".into(),
        deployment_scope: "project".into(),
        profile_version: "cursor-v1".into(),
    };
    let stages = evidence::latest_by_stage(&conn, &key).unwrap_or_default();
    let evidence_ok = stages
        .iter()
        .any(|s| s.stage == Stage::TargetDiscovered && s.status == Status::Success)
        && stages
            .iter()
            .any(|s| s.stage == Stage::SessionLoaded && s.status == Status::Unknown);
    report_line(
        evidence_ok,
        "evidence-store-graded-logging",
        "cursor evidence has target_discovered=success, session_loaded=unknown".into(),
    );

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
    let fail_batch_res = skill_flow::deploy_batch_planned(
        &mut conn,
        &s2_snap,
        &[t_roll1.clone(), t_fail],
        std::slice::from_ref(&managed_root),
    );
    let rollback_ok = fail_batch_res
        .as_ref()
        .map(|r| !r.success && r.rolled_back_count == 1)
        .unwrap_or(false)
        && !t_roll1.path.exists();
    report_line(
        rollback_ok,
        "compensating-rollback-verification",
        "runtime failure cleanly triggered compensating rollback for prior targets".into(),
    );

    println!("=== Aster M3 无头自检完成: {} failures ===", failures);
    failures
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
