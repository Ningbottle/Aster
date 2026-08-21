//! Tauri command 入口。阻塞 IO 的命令声明为 `async fn`，让 Tauri 派发到
//! 异步运行时，而不是在 Win32 主线程（消息泵）上内联执行。

pub mod app;
pub mod boot;
pub mod diag;
pub mod dsh;
pub mod github;
pub mod pi;
pub mod project;
pub mod skills;
