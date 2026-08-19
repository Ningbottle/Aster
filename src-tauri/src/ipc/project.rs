use crate::pi::runtime::{
    decide_activate_project, decide_remove_project, ActivateProjectDecision, PiRuntimeManager,
};
use crate::platform::db;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProjectDto {
    pub path: String,
    pub display_name: String,
    pub last_opened_at: String,
    pub is_active: bool,
}

#[tauri::command]
pub fn project_choose(
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

    let (_layout, conn) = crate::platform::open_layout_and_db()?;
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
pub fn project_recent_list() -> Result<Vec<RecentProjectDto>, String> {
    let (_layout, conn) = crate::platform::open_layout_and_db()?;
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
pub fn project_get_active() -> Result<Option<String>, String> {
    let (_layout, conn) = crate::platform::open_layout_and_db()?;
    db::get_active_project(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_set_active(
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
    let (_layout, conn) = crate::platform::open_layout_and_db()?;
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
pub fn project_remove(runtime: tauri::State<PiRuntimeManager>, path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    decide_remove_project(runtime.active_binding().as_ref(), &p)?;
    let (_layout, conn) = crate::platform::open_layout_and_db()?;
    db::remove_recent_project(&conn, path.trim()).map_err(|e| e.to_string())?;
    if let Ok(Some(active)) = db::get_active_project(&conn) {
        if active == path.trim() {
            let _ = conn.execute("DELETE FROM meta WHERE key = 'active_project'", []);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn project_pick_directory() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择 Aster 工作目录 / 项目根目录")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn host_workdir_set(host: String, path: String) -> Result<(), String> {
    let clean_path = path.trim();
    if !clean_path.is_empty() {
        let p = PathBuf::from(clean_path);
        if !p.is_dir() {
            return Err(format!("宿主目录不存在: {}", p.display()));
        }
    }
    let (_layout, conn) = crate::platform::open_layout_and_db()?;
    db::set_host_workdir(&conn, &host, clean_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn host_workdir_get(host: String) -> Result<Option<String>, String> {
    let (_layout, conn) = crate::platform::open_layout_and_db()?;
    db::get_host_workdir(&conn, &host).map_err(|e| e.to_string())
}
