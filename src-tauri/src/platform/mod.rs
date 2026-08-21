pub mod app_data;
pub mod credentials;
pub mod db;
pub mod evidence;
pub mod logging;
pub mod supervisor;
mod winjob;

pub fn open_layout_and_db() -> Result<(app_data::AppDataLayout, rusqlite::Connection), String> {
    let layout = app_data::AppDataLayout::open_default().map_err(|e| e.to_string())?;
    let mut conn =
        db::open_connection(&layout.database.join("aster.db")).map_err(|e| e.to_string())?;
    db::migrate(&mut conn).map_err(|e| e.to_string())?;
    Ok((layout, conn))
}
