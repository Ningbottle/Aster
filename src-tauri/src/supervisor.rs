//! Windows 进程监管基础（content.md §5/§12）。
//!
//! M0 覆盖：以普通用户权限启动子进程、查询状态、等待退出、终止进程树，
//! 并区分退出原因。输出捕获与完整取消状态机属于 M1/M2 的连接器职责。
//!
//! 退出分类语义：
//! - `CleanExit`：进程自行以 0 退出；
//! - `FailureExit`：进程自行以非 0 退出（崩溃或错误）；
//! - `TerminatedByAster`：Aster 主动请求终止后进程消失。
//!   M1 引入真实 RPC 取消后再区分“请求取消 / 宿主确认取消 / 被杀”。

use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// 只传入显式列出的环境变量；不继承默认之外的隐式状态。
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitKind {
    /// 自行退出，退出码 0。
    CleanExit,
    /// 自行退出，退出码非 0（崩溃或失败）。
    FailureExit(i32),
    /// Aster 请求终止后消失（被 taskkill /T /F 结束）。
    TerminatedByAster,
}

#[derive(Debug)]
pub struct ChildProcess {
    child: Child,
    stop_requested: bool,
}

impl ChildProcess {
    /// 以普通用户权限启动子进程。继承父进程环境（追加/覆盖 `env` 项），
    /// stdout/stderr 不捕获（M0 未实现输出管道）。
    pub fn spawn(spec: &SpawnSpec) -> io::Result<Self> {
        let mut cmd = Command::new(&spec.program);
        cmd.args(&spec.args);
        if let Some(cwd) = &spec.cwd {
            cmd.current_dir(cwd);
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Ok(Self {
            child: cmd.spawn()?,
            stop_requested: false,
        })
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn stop_requested(&self) -> bool {
        self.stop_requested
    }

    /// 非阻塞查询。
    pub fn try_wait(&mut self) -> io::Result<Option<ExitKind>> {
        match self.child.try_wait()? {
            Some(status) => Ok(Some(self.classify(status.code()))),
            None => Ok(None),
        }
    }

    /// 阻塞等待退出并分类。
    pub fn wait(&mut self) -> io::Result<ExitKind> {
        let status = self.child.wait()?;
        Ok(self.classify(status.code()))
    }

    /// 终止整个进程树（taskkill /T /F）并等待收回。
    /// 子进程自己再派生的进程也会被结束，这是宿主监管的必要语义。
    pub fn stop_tree(&mut self) -> io::Result<ExitKind> {
        self.stop_requested = true;
        let status = Command::new("taskkill")
            .args(["/PID", &self.child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        match status {
            Ok(kill) if kill.success() => self.wait(),
            // taskkill 可能因竞态返回非 0（进程恰好已退出）；以实际回收结果为准。
            _ => self.wait(),
        }
    }

    /// 带超时的等待。超时返回 None，调用方决定继续等或 stop_tree。
    pub fn wait_timeout(&mut self, timeout: Duration) -> io::Result<Option<ExitKind>> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(kind) = self.try_wait()? {
                return Ok(Some(kind));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn classify(&self, code: Option<i32>) -> ExitKind {
        if self.stop_requested {
            return ExitKind::TerminatedByAster;
        }
        match code {
            Some(0) => ExitKind::CleanExit,
            Some(n) => ExitKind::FailureExit(n),
            // Windows 上被外部终止通常仍有退出码；无码按失败处理，不伪装成功。
            None => ExitKind::FailureExit(-1),
        }
    }
}

/// 校验用户提供的版本号只含安全字符（数字、点、连字符、字母）。
/// 该字符串会被拼进经 cmd /C 执行的 npm 包名，必须先杀掉命令注入面。
pub fn is_safe_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && v.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
}

/// 按终止整个进程树（taskkill /T /F）。供连接器在只有 pid 时使用。
pub fn kill_process_tree(pid: u32) -> io::Result<()> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        // 进程可能已退出；taskkill 找不到目标不算致命错误
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd_spec(args: &[&str]) -> SpawnSpec {
        SpawnSpec {
            program: "cmd".into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: None,
            env: BTreeMap::new(),
        }
    }

    #[test]
    fn normal_exit_is_classified_clean() {
        let mut child = ChildProcess::spawn(&cmd_spec(&["/C", "exit", "0"])).unwrap();
        let kind = child.wait().unwrap();
        assert_eq!(kind, ExitKind::CleanExit);
    }

    #[test]
    fn nonzero_exit_is_classified_failure() {
        let mut child = ChildProcess::spawn(&cmd_spec(&["/C", "exit", "3"])).unwrap();
        let kind = child.wait().unwrap();
        assert_eq!(kind, ExitKind::FailureExit(3));
    }

    #[test]
    fn cancelled_long_process_is_classified_terminated() {
        // ping 挂起约 5 秒，模拟需要被取消的长时间运行的宿主进程。
        let mut child =
            ChildProcess::spawn(&cmd_spec(&["/C", "ping", "-n", "5", "127.0.0.1"])).unwrap();
        assert!(child.try_wait().unwrap().is_none(), "进程应当仍在运行");
        assert!(!child.stop_requested(), "尚未请求取消");

        let started = Instant::now();
        let kind = child.stop_tree().unwrap();
        assert_eq!(kind, ExitKind::TerminatedByAster);
        assert!(child.stop_requested());
        assert!(started.elapsed() < Duration::from_secs(4), "取消不应等待自然退出");
    }

    #[test]
    fn missing_program_is_spawn_error() {
        let spec = SpawnSpec {
            program: "aster-definitely-missing-program".into(),
            args: vec![],
            cwd: None,
            env: BTreeMap::new(),
        };
        let err = ChildProcess::spawn(&spec).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn wait_timeout_returns_none_while_running() {
        let mut child =
            ChildProcess::spawn(&cmd_spec(&["/C", "ping", "-n", "5", "127.0.0.1"])).unwrap();
        assert!(child
            .wait_timeout(Duration::from_millis(200))
            .unwrap()
            .is_none());
        child.stop_tree().unwrap();
    }
}
