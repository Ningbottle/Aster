pub mod connector;

use connector::{self as dsh_connector, DshRuntime};
use crate::platform::{app_data, db};
use std::path::PathBuf;

/// DSH 会话使用的工作目录：
/// 1. 优先使用宿主专属覆盖 host_workdir('dsh')；
/// 2. 其次使用全局活动项目 active_project；
/// 3. 最后回退到 sessions/dsh-workspace。
pub fn workspace(layout: &app_data::AppDataLayout, conn: Option<&rusqlite::Connection>) -> PathBuf {
    if let Some(conn) = conn {
        if let Ok(Some(hw)) = db::get_host_workdir(conn, "dsh") {
            let p = PathBuf::from(&hw);
            if p.is_dir() {
                return p;
            }
        }
        if let Ok(Some(ap)) = db::get_active_project(conn) {
            let p = PathBuf::from(ap);
            if p.is_dir() {
                return p;
            }
        }
    }
    let dir = layout.sessions.join("dsh-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn locked_runtime() -> Result<DshRuntime, String> {
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
