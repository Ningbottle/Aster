#![allow(clippy::unused_async)]

use crate::hosts::profile as host_profile;
use crate::platform::{app_data, db, evidence, open_layout_and_db};
use serde::Serialize;

#[derive(Serialize)]
pub struct AppStatus {
    app_version: String,
    app_data_dir: String,
    database_schema_version: u32,
    evidence_count: i64,
}

#[tauri::command]
pub async fn get_app_status() -> Result<AppStatus, String> {
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

#[tauri::command]
pub async fn host_profiles_list(
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
