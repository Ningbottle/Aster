pub mod connector;
pub mod runtime;
pub mod sessions;

use connector::{self as pi_connector, PiRuntime};
use crate::platform::{app_data, db};
use std::path::PathBuf;

/// Pi 会话使用的工作目录：
/// 1. 优先使用宿主专属覆盖 host_workdir('pi')；
/// 2. 其次使用全局活动项目 active_project；
/// 3. 最后回退到 sessions/pi-workspace。
pub fn workspace(layout: &app_data::AppDataLayout, conn: Option<&rusqlite::Connection>) -> PathBuf {
    if let Some(conn) = conn {
        if let Ok(Some(hw)) = db::get_host_workdir(conn, "pi") {
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
    let dir = layout.sessions.join("pi-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn locked_runtime() -> Result<PiRuntime, String> {
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
