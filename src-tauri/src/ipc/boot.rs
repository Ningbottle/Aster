use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    // 必须最早执行：后续所有诊断记录都靠它判定 on_main。
    super::diag::init_main_thread();

    // 用 Wry 显式定型，才能把 generate_handler! 的闭包先绑定再包一层诊断。
    // 这一层是审计期唯一的 IPC 观测点：它对同步命令测到的是命令体的完整耗时
    // （sync command 在 wry IPC 回调里内联执行），对 async 命令只测到派发耗时。
    // 因此 elapsed_ms 本身就是「该命令是否占用主线程」的判据。
    type WryInvoke = tauri::ipc::Invoke<tauri::Wry>;
    let invoke_handler: Box<dyn Fn(WryInvoke) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            super::app::get_app_status,
            super::pi::pi_discover,
            super::pi::pi_install_managed,
            super::pi::pi_get_available_models,
            super::pi::pi_project_tree_refresh,
            super::pi::pi_session_create,
            super::pi::pi_session_open,
            super::pi::pi_session_snapshot,
            super::pi::pi_session_set_name,
            super::pi::pi_session_set_model,
            super::pi::pi_session_set_thinking_level,
            super::pi::pi_session_prompt,
            super::pi::pi_session_abort,
            super::pi::pi_session_stop,
            super::pi::pi_session_index_remove,
            super::pi::pi_session_archive,
            super::pi::pi_runtime_snapshot,
            super::dsh::dsh_discover,
            super::dsh::dsh_install_managed,
            super::dsh::dsh_start,
            super::dsh::dsh_stop,
            super::dsh::dsh_status,
            super::dsh::dsh_open_window,
            super::skills::skill_status,
            super::skills::skills_list,
            super::app::host_profiles_list,
            super::skills::skills_scan_repo,
            super::skills::skills_scan_github,
            super::skills::skill_get_diff,
            super::skills::skill_get_translation,
            super::skills::skill_save_translation,
            super::skills::skill_batch_deploy_plan,
            super::skills::skill_batch_deploy_apply,
            super::project::project_choose,
            super::project::project_recent_list,
            super::project::project_get_active,
            super::project::project_set_active,
            super::project::project_remove,
            super::project::project_pick_directory,
            super::project::host_workdir_set,
            super::project::host_workdir_get,
            super::github::github_device_start,
            super::github::github_device_poll,
            super::github::github_token_status,
            super::github::github_set_pat,
            super::github::github_logout,
            super::skills::skill_quarantine_list,
            super::skills::skill_quarantine_delete
        ]);

    tauri::Builder::default()
        .manage(crate::pi::runtime::PiRuntimeManager::default())
        .manage(super::dsh::DshSlot {
            server: Mutex::new(None),
        })
        .invoke_handler(move |invoke| {
            let _span = super::diag::span("ipc", invoke.message.command().to_string());
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
                super::diag::record(
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
                            let _span =
                                super::diag::span("shutdown", format!("close_window:{label}"));
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
                super::diag::record("runevent", serde_json::json!({ "event": name }));
            }
            // 应用真正退出前兜底清理：停止仍在运行的宿主子进程树。
            if matches!(event, tauri::RunEvent::Exit) {
                // 整个 Exit 清理都在主线程上；这个 Span 的 elapsed_ms 就是
                // “窗口已消失但 aster.exe 仍在任务管理器里”的那段时间。
                let _exit_span = super::diag::span("shutdown", "run_event_exit");
                // 用 try_lock 而非 lock：若锁被卡死的后台任务长期持有（例如
                // WebView2 第二窗口初始化挂起期间的建窗命令），退出流程不得
                // 随之挂死——宁可跳过兜底停止，也不能让进程退不出。
                let dsh = handle.state::<super::dsh::DshSlot>();
                {
                    let mut span = super::diag::span("shutdown", "dsh_stop");
                    match dsh.server.try_lock() {
                        Ok(mut guard) => match guard.take() {
                            Some(mut server) => {
                                let pid = server.pid();
                                let result = server
                                    .stop_with_budget(crate::dsh::connector::DSH_EXIT_STOP_WAIT);
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
                    let mut span = super::diag::span("shutdown", "pi_stop");
                    let pi = handle.state::<crate::pi::runtime::PiRuntimeManager>();
                    match pi.try_stop() {
                        Ok(()) => {
                            if let Some(s) = span.as_mut() {
                                s.note("ok=true");
                            }
                        }
                        Err(e) => {
                            if let Some(s) = span.as_mut() {
                                s.note(format!("skipped: {e}"));
                            }
                        }
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
    use crate::ipc::dsh::{dsh_open_window, dsh_status, DshSlot};
    use crate::ipc::github::github_device_poll;
    use crate::ipc::pi::{pi_runtime_snapshot, pi_session_abort, pi_session_snapshot};
    use crate::pi::runtime::PiRuntimeManager;
    use tauri::State;

    fn is_future<F: std::future::Future>(_: &F) {}

    // wry#583 / tauri 官方文档：Windows 上在同步命令或事件处理器中 build() 第二个
    // WebView2 窗口会死锁主线程。用类型系统锁定关键命令保持 async。
    #[test]
    fn dsh_open_window_stays_async() {
        let _check = |app: tauri::AppHandle, state: tauri::State<'_, DshSlot>| {
            is_future(&dsh_open_window(app, state));
        };
    }

    #[test]
    fn blocking_commands_stay_async() {
        let _abort = |state: State<'_, PiRuntimeManager>| {
            is_future(&pi_session_abort(state));
        };
        let _snap = |state: State<'_, PiRuntimeManager>| {
            is_future(&pi_session_snapshot(state));
        };
        let _runtime_snap = |state: State<'_, PiRuntimeManager>| {
            is_future(&pi_runtime_snapshot(state));
        };
        let _status = |state: tauri::State<'_, DshSlot>| {
            is_future(&dsh_status(state));
        };
        let _poll = || {
            is_future(&github_device_poll(String::new(), String::new()));
        };
    }

    #[test]
    fn ipc_does_not_register_unscoped_skill_rollback_or_m1_pipeline() {
        let src = include_str!("boot.rs");
        let handler = src
            .split("generate_handler![")
            .nth(1)
            .and_then(|rest| rest.split(']').next())
            .expect("generate_handler list");
        for banned in [
            "skill_rollback_latest",
            "skill_rollback_all",
            "skill_m1_pipeline",
        ] {
            assert!(
                !handler.contains(banned),
                "{banned} must not be a Tauri command"
            );
        }
    }
}
