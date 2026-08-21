#![allow(clippy::unused_async)] // blocking bodies; async only to leave the Win32 UI thread

use crate::dsh::connector::{
    self as dsh_connector, DshRuntime, DshServer, DshStatus, DSH_STOP_WAIT,
};
use crate::platform::{app_data, db};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// 共享状态：单个活跃 DSH Web 服务实例。
pub struct DshSlot {
    pub server: Mutex<Option<DshServer>>,
}

fn lock_slot(slot: &DshSlot) -> Result<std::sync::MutexGuard<'_, Option<DshServer>>, String> {
    slot.server
        .lock()
        .map_err(|e| format!("dsh server lock failed: {e}"))
}

#[tauri::command]
pub async fn dsh_discover() -> Result<Vec<DshRuntime>, String> {
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtimes = dsh_connector::discover(&root);
    if let Ok((_layout, conn)) = crate::platform::open_layout_and_db() {
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
pub async fn dsh_install_managed(version: Option<String>) -> Result<DshRuntime, String> {
    let ver = version
        .as_deref()
        .unwrap_or(dsh_connector::LOCKED_DSH_VERSION);
    let root = app_data::AppDataLayout::default_root().map_err(|e| e.to_string())?;
    let runtime = dsh_connector::install_managed(&root, ver)?;
    if let Ok((_layout, conn)) = crate::platform::open_layout_and_db() {
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
pub async fn dsh_start(
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
    let runtime = crate::dsh::locked_runtime()?;
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    let workspace = crate::dsh::workspace(&layout, Some(&conn));

    let existing = {
        let mut guard = lock_slot(&state)?;
        guard.take()
    };
    if let Some(mut old) = existing {
        let _ = old.stop();
    }

    let pref_port = port.unwrap_or(dsh_connector::DEFAULT_DSH_PORT);
    let server = DshServer::spawn(&layout.root, &runtime, &workspace, &host, pref_port)?;
    let log_path = layout.root.join("logs").join("dsh-server.log");
    let url = server.url().to_string();
    let readiness = server.readiness();
    {
        let mut guard = lock_slot(&state)?;
        *guard = Some(server);
    }

    let ready_span = crate::diag::span("dsh_wait_ready", format!("url={url}"));
    let ready = readiness.wait_ready(Duration::from_secs(90));
    drop(ready_span);
    if !ready {
        let layers = readiness.probe();
        let taken = {
            let mut guard = lock_slot(&state)?;
            guard.take()
        };
        if let Some(mut s) = taken {
            let _ = s.stop();
        }
        let tail = std::fs::read(&log_path)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .map(|t| {
                let start = t.len().saturating_sub(2048);
                t[start..].to_string()
            })
            .unwrap_or_default();
        return Err(format!(
            "DSH service at {url} failed health check within 90s \
             (runner_alive={}, static_ok={}, boot_ok={}); dsh-server.log tail: {tail}",
            layers.runner_alive, layers.static_ok, layers.boot_ok
        ));
    }

    let guard = lock_slot(&state)?;
    guard
        .as_ref()
        .map(|s| s.status())
        .ok_or_else(|| "DSH server disappeared during start".to_string())
}

#[tauri::command]
pub async fn dsh_stop(state: tauri::State<'_, DshSlot>) -> Result<(), String> {
    let taken = {
        let mut guard = lock_slot(&state)?;
        guard.take()
    };
    if let Some(mut server) = taken {
        server
            .stop_with_budget(DSH_STOP_WAIT)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn dsh_status(state: tauri::State<'_, DshSlot>) -> Result<Option<DshStatus>, String> {
    let guard = lock_slot(&state)?;
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
pub async fn dsh_open_window(
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
