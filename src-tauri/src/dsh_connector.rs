//! DeepSeek Harness 独立宿主连接器。
//!
//! Aster Alpha 优先承载 DSH 原生 Web UI，而不是重新实现对话与模式系统。
//! DSH 拥有独立的工作区、插件系统、自定义模式与会话持久化。
//!
//! 本连接器负责：
//! - 发现 Aster-managed（runtimes/dsh/<v>/...）与外部 DSH 安装（只读，无副作用）；
//! - 安装锁定版本的官方 DSH CLI 包 `@deepseek-ai/dsh`（版本字符串严格校验）；
//! - 动态分配 localhost 端口并检测冲突；
//! - 通过官方 CLI（`node bin.js web --host 127.0.0.1 --port <port>`，与
//!   `npx @deepseek-ai/dsh web` 等价）启动 DSH Web 服务——不再自行拼装
//!   WebApp runner：旧 runner 只静态加载 dsh-web-app，缺少官方服务端注入的
//!   window.__DSH_BOOT__ boot manifest，前端 AppWebEntry 解析失败、页面必然
//!   空白（2026-08-18 真实 UI 审计确认的 R2 根因）；
//! - 分层健康检查（进程存活 / 静态页面可达 / boot manifest 已注入），
//!   不再把“能返回 SPA HTML”当作可用证据；
//! - 停止时等待进程回收（超时如实报错），退出清理由 lib.rs 生命周期钩子兜底。

use serde::Serialize;
use std::io::{self, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// M2 锁定的 DSH 首发支持版本（来自 2026-08-13 发布的完整 web-app bundle）。
pub const LOCKED_DSH_VERSION: &str = "0.1.0-rc.6";

/// 默认首选端口。
pub const DEFAULT_DSH_PORT: u16 = 38472;

/// 健康探针在响应体中查找的静态标记（真实 SPA 页面包含它们），
/// 用于确认端口上响应的是我们的 DSH 原生服务而非无关进程。
pub const HEALTH_MARKER_TITLE: &str = "DeepSeek Harness";
pub const HEALTH_MARKER_ROOT: &str = "<div id=\"root\"></div>";

/// 官方 CLI 服务端向首页注入的 boot manifest 标记（2026-08-18 对
/// `@deepseek-ai/dsh@0.1.0-rc.6` 实证：响应体头部含
/// `<script>window.__DSH_BOOT__ = {...}</script>`）。前端 dsh-client-web 的
/// AppWebEntry.run() 解析它；缺失即启动失败。boot_ok 只证明“前端可以启动”，
/// 真实渲染与可交互仍需真实 UI 验收。
pub const HEALTH_MARKER_BOOT: &str = "window.__DSH_BOOT__";

#[derive(Debug, Clone, Serialize)]
pub struct DshRuntime {
    pub version: String,
    /// 官方 CLI 入口（`@deepseek-ai/dsh/lib/bin.js` 的绝对路径）。
    pub entry_path: String,
    pub managed: bool,
    pub supported: bool,
}

/// 发现 DSH 安装：Aster-managed（runtimes/dsh/<v>/...）与外部 npm 全局安装。
/// 识别依据是官方 CLI 包 `@deepseek-ai/dsh` 的入口 `lib/bin.js`——仅含
/// dsh-web-app 的旧布局（自行拼装 runner 时代）没有 boot 注入链路，不得
/// 识别为完整宿主（由 m2_flow 的失败测试锁定）。只读操作，不向任何目录写入。
pub fn discover(app_data_root: &Path) -> Vec<DshRuntime> {
    let mut found = Vec::new();
    let runtimes = app_data_root.join("runtimes").join("dsh");
    if let Ok(entries) = std::fs::read_dir(&runtimes) {
        for entry in entries.flatten() {
            let cli_pkg = entry
                .path()
                .join("node_modules")
                .join("@deepseek-ai")
                .join("dsh");
            let cli_bin = cli_pkg.join("lib").join("bin.js");
            if cli_bin.is_file() {
                let ver = read_version_from_pkg_json(&cli_pkg.join("package.json"))
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
                let supported = ver == LOCKED_DSH_VERSION;
                found.push(DshRuntime {
                    version: ver,
                    entry_path: cli_bin.to_string_lossy().to_string(),
                    managed: true,
                    supported,
                });
            }
        }
    }

    // 外部 npm 全局安装：同一规则，只读探测官方 CLI 包
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let global_dsh = PathBuf::from(&appdata)
            .join("npm")
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh");
        let cli_bin = global_dsh.join("lib").join("bin.js");
        if cli_bin.is_file() {
            let ver = read_version_from_pkg_json(&global_dsh.join("package.json"))
                .unwrap_or_else(|| "unknown".into());
            let supported = ver == LOCKED_DSH_VERSION;
            found.push(DshRuntime {
                version: ver,
                entry_path: cli_bin.to_string_lossy().to_string(),
                managed: false,
                supported,
            });
        }
    }

    found.sort_by_key(|b| std::cmp::Reverse(version_key(&b.version)));
    found
}

/// 读取日志尾部（最多 max 字节），用于把子进程失败原因带进错误消息。
fn read_log_tail(path: &Path, max: usize) -> String {
    let Ok(bytes) = std::fs::read(path) else {
        return String::new();
    };
    let start = bytes.len().saturating_sub(max);
    String::from_utf8_lossy(&bytes[start..]).trim().to_string()
}

/// 把 "x.y.z(-pre)" 解析为可比较的数值元组；解析失败回退 (0,0,0)。
fn version_key(v: &str) -> (u64, u64, u64) {
    let core = v.split('-').next().unwrap_or(v);
    let mut it = core.split('.');
    (
        it.next().and_then(|p| p.parse().ok()).unwrap_or(0),
        it.next().and_then(|p| p.parse().ok()).unwrap_or(0),
        it.next().and_then(|p| p.parse().ok()).unwrap_or(0),
    )
}

fn read_version_from_pkg_json(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    val.get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// 安装 Aster-managed DSH 运行时到 runtimes/dsh/<version>。
pub fn install_managed(app_data_root: &Path, version: &str) -> Result<DshRuntime, String> {
    if !crate::supervisor::is_safe_version(version) {
        return Err(format!("invalid version string: {version}"));
    }
    let target_dir = app_data_root.join("runtimes").join("dsh").join(version);
    // 目标目录已存在且非空但不是 DSH 安装布局时拒绝写入（不覆盖未知内容）
    if target_dir.exists()
        && std::fs::read_dir(&target_dir)
            .map(|d| d.count() > 0)
            .unwrap_or(false)
        && !target_dir.join("node_modules").is_dir()
    {
        return Err(format!(
            "runtimes/dsh/{} already exists with non-runtime content; refusing to overwrite",
            version
        ));
    }
    let entry_file = target_dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");

    if !entry_file.is_file() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("create runtime dir failed: {e}"))?;

        // 版本已通过 is_safe_version 校验（仅数字/点/连字符），prefix 路径
        // 来自 Aster 自身布局；再防御性拒绝含 cmd 元字符的路径。
        let dir_str = target_dir.to_string_lossy().to_string();
        if ['&', '|', '^', '<', '>', '(', ')', '%', '!', '"', '\'']
            .iter()
            .any(|c| dir_str.contains(*c))
        {
            return Err(format!(
                "runtime dir path contains shell metacharacters: {dir_str}"
            ));
        }

        let pkg_spec = format!("@deepseek-ai/dsh@{version}");
        let out = Command::new("cmd")
            .args([
                "/C",
                "npm",
                "install",
                "--no-audit",
                "--no-fund",
                "--prefix",
                &dir_str,
                &pkg_spec,
            ])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("failed to invoke npm: {e}"))?;

        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("npm install {pkg_spec} failed: {err}"));
        }

        if !entry_file.is_file() {
            return Err(format!(
                "npm install succeeded but entry file not found at {}",
                entry_file.display()
            ));
        }
    }

    Ok(DshRuntime {
        version: version.to_string(),
        entry_path: entry_file.to_string_lossy().to_string(),
        managed: true,
        supported: version == LOCKED_DSH_VERSION,
    })
}

/// 查找 127.0.0.1 上可用的 TCP 端口（从 start_port 起尝试最多 100 个端口）。
pub fn find_available_port(start_port: u16) -> Option<u16> {
    (start_port..start_port.saturating_add(100))
        .find(|&p| TcpListener::bind(("127.0.0.1", p)).is_ok())
}

/// 分层健康证据：runner 存活、静态资源可达、boot manifest 已注入。
/// 分开暴露，防止“能返回 SPA HTML”被合并误读为“前端可用”。
#[derive(Debug, Clone, Copy)]
pub struct HealthLayers {
    pub runner_alive: bool,
    pub static_ok: bool,
    pub boot_ok: bool,
}

impl HealthLayers {
    pub fn healthy(&self) -> bool {
        self.runner_alive && self.static_ok && self.boot_ok
    }
}

/// DSH 运行状态视图。
#[derive(Debug, Clone, Serialize)]
pub struct DshStatus {
    pub running: bool,
    /// 三层探针全部通过（进程存活 + 静态页面 + boot manifest 注入）。
    pub healthy: bool,
    /// 分层证据：未主动停止且子进程仍存活。
    pub runner_alive: bool,
    /// 分层证据：HTTP 200 且响应体含 SPA title/#root 静态标记。
    pub static_ok: bool,
    /// 分层证据：响应体含 window.__DSH_BOOT__（前端可启动的必要条件）。
    pub boot_ok: bool,
    pub port: u16,
    pub url: String,
    pub version: String,
    pub managed: bool,
    pub pid: Option<u32>,
    /// Starting/Ready/Busy/Stopping/Crashed/Needs setup/Unknown.
    /// Derived from the live DshServer slot, not from a UI click.
    pub lifecycle: String,
}

/// 一个活跃的 DSH Web 服务实例。
pub struct DshServer {
    child: Arc<Mutex<Child>>,
    port: u16,
    url: String,
    version: String,
    managed: bool,
    stopped: Arc<AtomicBool>,
}

impl DshServer {
    /// 通过官方 CLI 启动 DSH Web 服务进程，并等待健康探针三层全部就绪。
    ///
    /// 命令形态与官方 `npx @deepseek-ai/dsh web` 一致（web 是 --profile web
    /// 的别名；profile 缺失时 CLI 在 $DSH_HOME 下自愈创建）：
    /// `node <@deepseek-ai/dsh/lib/bin.js> web --host <host> --port <port>
    ///   --trusted-host <host:port>`
    ///
    /// 环境语义（经 .dsh-probe 实证，2026-08-18）：
    /// - `DSH_HOME` 指向 Aster 管理的 dsh-home/（DSH 的 profiles/用户补丁根）；
    /// - `DSH_TELEMETRY_DISABLED=1` 关闭遥测（官方隐私开关：任何非空值即禁用）；
    /// - `cwd = workspace`：dsh-fs-local 的 cwd 配置默认取 process.cwd()。
    /// 旧 runner 的 PORT/HOST/DSH_WORKSPACE/DSH_CONFIG_DIR 在官方包中没有
    /// 消费者，属于假动作，已删除。
    pub fn start(
        app_data_root: &Path,
        runtime: &DshRuntime,
        workspace: &Path,
        host: &str,
        preferred_port: u16,
    ) -> Result<Self, String> {
        let cli = PathBuf::from(&runtime.entry_path);
        if !cli.is_file() {
            return Err(format!(
                "official DSH CLI entry not found at {}; reinstall DSH {}",
                cli.display(),
                runtime.version
            ));
        }
        let dsh_home = app_data_root.join("dsh-home");
        std::fs::create_dir_all(&dsh_home).map_err(|e| format!("create dsh home dir: {e}"))?;

        let port = find_available_port(preferred_port)
            .ok_or_else(|| format!("no available port starting from {preferred_port}"))?;
        let url = format!("http://{host}:{port}");

        std::fs::create_dir_all(workspace).map_err(|e| format!("create workspace dir: {e}"))?;

        let mut cmd = Command::new("node");
        cmd.arg(&cli)
            .arg("web")
            .arg("--host")
            .arg(host)
            .arg("--port")
            .arg(port.to_string())
            .arg("--trusted-host")
            .arg(format!("{host}:{port}"))
            .env("DSH_HOME", &dsh_home)
            .env("DSH_TELEMETRY_DISABLED", "1")
            .current_dir(workspace);

        // 子进程输出落到 Aster 自己的 logs 目录：官方 CLI 首次引导会做 profile
        // 自愈与依赖链接，失败时只有这份输出可诊断（截断到尾部 2KB 进错误消息）。
        let log_dir = app_data_root.join("logs");
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir: {e}"))?;
        let log_path = log_dir.join("dsh-server.log");
        let log_out =
            std::fs::File::create(&log_path).map_err(|e| format!("create dsh log: {e}"))?;
        let log_err = log_out
            .try_clone()
            .map_err(|e| format!("clone dsh log handle: {e}"))?;

        cmd.stdin(Stdio::null())
            .stdout(Stdio::from(log_out))
            .stderr(Stdio::from(log_err));

        let child = cmd
            .spawn()
            .map_err(|e| format!("spawn DSH process failed: {e}"))?;
        crate::diag::proc_event("spawn", "dsh", child.id());

        let server = Self {
            child: Arc::new(Mutex::new(child)),
            port,
            url: url.clone(),
            version: runtime.version.clone(),
            managed: runtime.managed,
            stopped: Arc::new(AtomicBool::new(false)),
        };

        // 等待健康检查三层全部就绪。官方 CLI 首次引导（profile 自愈、
        // 依赖链接、模块预热）实测可能超过 25 秒，给 90 秒；子进程提前
        // 退出时 wait_ready 会立即返回，不会空等。
        let ready_span = crate::diag::span("dsh_wait_ready", format!("port={port}"));
        let ready = server.wait_ready(Duration::from_secs(90));
        drop(ready_span);
        if !ready {
            let layers = server.probe();
            let exited = server.child_exited();
            let mut s = server;
            let _ = s.stop();
            let tail = read_log_tail(&log_path, 2048);
            return Err(if exited {
                format!(
                    "DSH process exited before becoming healthy at {url}; dsh-server.log tail: {tail}"
                )
            } else {
                format!(
                    "DSH service at {url} failed health check within 90s \
                     (runner_alive={}, static_ok={}, boot_ok={}); dsh-server.log tail: {tail}",
                    layers.runner_alive, layers.static_ok, layers.boot_ok
                )
            });
        }

        Ok(server)
    }

    /// 仅由内部测试或模拟器使用的快速构造器（用于端口冲突与状态测试）。
    pub fn new_for_testing(child: Child, port: u16, version: String, managed: bool) -> Self {
        Self {
            child: Arc::new(Mutex::new(child)),
            port,
            url: format!("http://127.0.0.1:{port}"),
            version,
            managed,
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn pid(&self) -> u32 {
        self.child.lock().map(|c| c.id()).unwrap_or(0)
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// 子进程是否已退出（存活探测）。
    fn child_exited(&self) -> bool {
        self.child
            .lock()
            .map(|mut c| c.try_wait().map(|s| s.is_some()).unwrap_or(true))
            .unwrap_or(true)
    }

    /// 单次 HTTP GET 分层探测：
    /// - runner_alive：未主动停止且子进程仍存活；
    /// - static_ok：200 且响应体含 title 与 #root 静态标记（防误认同端口无关服务）；
    /// - boot_ok：响应体含 window.__DSH_BOOT__（官方 CLI 服务端注入的 boot manifest；
    ///   前端缺失它必然空白——这是区分新旧 runner 的决定性证据）。
    pub fn probe(&self) -> HealthLayers {
        let mut layers = HealthLayers {
            runner_alive: !self.is_stopped() && !self.child_exited(),
            static_ok: false,
            boot_ok: false,
        };
        if !layers.runner_alive {
            return layers;
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_millis(500))
            .timeout_read(Duration::from_millis(1000))
            .build();
        let resp = match agent.get(&self.url).call() {
            Ok(resp) => resp,
            Err(_) => return layers,
        };
        if resp.status() != 200 {
            return layers;
        }
        let mut body = String::new();
        // 官方首页约 12KB（boot manifest 注入在 head，#root 在 body 尾部），
        // 读取上限必须覆盖完整页面，不能把截断误判为标记缺失。
        let reader = resp.into_reader();
        let mut limited = reader.take(65536);
        if limited.read_to_string(&mut body).is_err() {
            return layers;
        }
        layers.static_ok = body.contains(HEALTH_MARKER_TITLE) && body.contains(HEALTH_MARKER_ROOT);
        layers.boot_ok = body.contains(HEALTH_MARKER_BOOT);
        layers
    }

    /// 三层全部通过才算 healthy。
    pub fn probe_healthy(&self) -> bool {
        self.probe().healthy()
    }

    /// 轮询等待就绪；子进程提前退出立即返回 false，不空等超时。
    pub fn wait_ready(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.probe_healthy() {
                return true;
            }
            if self.child_exited() {
                return false;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        false
    }

    pub fn status(&self) -> DshStatus {
        let layers = self.probe();
        DshStatus {
            running: layers.runner_alive,
            healthy: layers.healthy(),
            runner_alive: layers.runner_alive,
            static_ok: layers.static_ok,
            boot_ok: layers.boot_ok,
            port: self.port,
            url: self.url.clone(),
            version: self.version.clone(),
            managed: self.managed,
            pid: if layers.runner_alive {
                Some(self.pid())
            } else {
                None
            },
            lifecycle: if !layers.runner_alive {
                "crashed".into()
            } else if layers.healthy() {
                "ready".into()
            } else {
                "unknown".into()
            },
        }
    }

    /// 终止 DSH 进程树并等待子进程回收。taskkill 返回不代表进程已消失；
    /// 超时如实报错，不把“已发 taskkill”伪装成“已停止”。
    pub fn stop(&mut self) -> io::Result<()> {
        if self.stopped.swap(true, Ordering::SeqCst) {
            return Ok(()); // 已停止过
        }
        let pid = self.pid();
        crate::diag::proc_event("stop_requested", "dsh", pid);
        // 这个 Span 覆盖 taskkill + 最多 5 秒的回收等待。退出路径上它整段
        // 占用主线程，是“窗口已消失但 aster.exe 还在”的主要来源。
        let mut span = crate::diag::span("dsh_stop_wait", format!("pid={pid}"));
        crate::supervisor::kill_process_tree(pid)?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if self.child_exited() {
                crate::diag::proc_event("exited", "dsh", pid);
                return Ok(());
            }
            if Instant::now() >= deadline {
                if let Some(s) = span.as_mut() {
                    s.note("TIMED OUT: still alive 5s after taskkill");
                }
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "DSH process still alive 5s after taskkill /T /F",
                ));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for DshServer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_available_port_finds_free_port() {
        let port = find_available_port(DEFAULT_DSH_PORT).expect("should find a free port");
        assert!(port >= DEFAULT_DSH_PORT);
    }

    #[test]
    fn find_available_port_skips_occupied_port() {
        let listener = TcpListener::bind(("127.0.0.1", 39900)).unwrap();
        let free = find_available_port(39900).unwrap();
        assert!(free > 39900, "free port {free} should skip occupied 39900");
        drop(listener);
    }

    #[test]
    fn version_key_orders_semver() {
        assert!(version_key("0.10.0") > version_key("0.9.3"));
        assert!(version_key("1.0.0") > version_key("0.84.2"));
    }

    #[test]
    fn install_rejects_unsafe_version() {
        let tmp = tempfile::tempdir().unwrap();
        let err = install_managed(tmp.path(), "0.1.0&calc").unwrap_err();
        assert!(err.contains("invalid version"), "{err}");
    }

    #[test]
    fn status_reports_not_running_after_process_exit() {
        // 一个立即退出的子进程：status 必须报告 running=false，而不是
        // 只依赖 stopped 标志。
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "exit", "0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd.spawn().unwrap();
        let server = DshServer::new_for_testing(child, 39920, "0.0.1".into(), true);
        std::thread::sleep(Duration::from_millis(200));
        let status = server.status();
        assert!(!status.running, "已退出的进程不得报告为 running");
        assert_eq!(status.pid, None);
    }

    /// 起一个最小本地 HTTP 服务，对每个连接固定返回给定 body。
    /// 必须先读掉请求再响应：带着未读数据直接关连机会触发 RST，
    /// 间歇性冲掉已写出的响应（此测试曾因此 flaky）。
    fn serve_fixed(body: &'static str) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};
            for stream in listener.incoming() {
                if let Ok(mut s) = stream {
                    let mut req = [0u8; 2048];
                    let _ = s.read(&mut req);
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = s.write_all(resp.as_bytes());
                    let _ = s.shutdown(std::net::Shutdown::Both);
                }
            }
        });
        port
    }

    fn long_running_child() -> Child {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ping", "-n", "30", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        cmd.spawn().unwrap()
    }

    #[test]
    fn probe_distinguishes_static_and_boot_layers() {
        // 只含静态标记（旧自拼 runner 的形态）：static_ok=true 但 boot_ok=false，
        // healthy 必须为 false——这正是 R2 空白页时期的误判来源。
        let html: &'static str = Box::leak(
            format!(
                "<html><head><title>{}</title></head><body>{}</body></html>",
                HEALTH_MARKER_TITLE, HEALTH_MARKER_ROOT
            )
            .into_boxed_str(),
        );
        let port = serve_fixed(html);
        let server = DshServer::new_for_testing(long_running_child(), port, "0.0.1".into(), true);
        // 与生产端 wait_ready 同语义：轮询到静态层通过（单次快照可能撞上接受线程未就绪）
        let layers = poll_layers(&server, Duration::from_secs(5), |l| l.static_ok);
        assert!(layers.runner_alive);
        assert!(layers.static_ok, "静态标记层应通过");
        assert!(!layers.boot_ok, "无 boot manifest 不得通过 boot 层");
        assert!(!layers.healthy(), "缺少 boot manifest 不得报告 healthy");
    }

    /// 轮询 probe 直到谓词满足或超时；返回最后一次快照。
    fn poll_layers(
        server: &DshServer,
        timeout: Duration,
        pred: impl Fn(&HealthLayers) -> bool,
    ) -> HealthLayers {
        let deadline = Instant::now() + timeout;
        let mut layers = server.probe();
        while !pred(&layers) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            layers = server.probe();
        }
        layers
    }

    #[test]
    fn probe_full_boot_marker_is_healthy() {
        let html: &'static str = Box::leak(
            format!(
                "<html><head><title>{}</title><script>window.__DSH_BOOT__ = {{\"rev\":\"x\"}}</script></head><body>{}</body></html>",
                HEALTH_MARKER_TITLE, HEALTH_MARKER_ROOT
            )
            .into_boxed_str(),
        );
        let port = serve_fixed(html);
        let server = DshServer::new_for_testing(long_running_child(), port, "0.0.1".into(), true);
        let layers = poll_layers(&server, Duration::from_secs(5), |l| l.healthy());
        assert!(
            layers.runner_alive && layers.static_ok && layers.boot_ok,
            "layers={layers:?}"
        );
        assert!(server.probe_healthy());
    }

    #[test]
    fn drop_cleans_up_process() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ping", "-n", "10", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd.spawn().unwrap();
        let pid = child.id();

        {
            let server = DshServer::new_for_testing(child, 39910, "0.0.1-rc.1".into(), true);
            assert_eq!(server.pid(), pid);
            // server 在此作用域结束时 drop
        }

        // drop 后由 taskkill 结束，进程应当已终止
        std::thread::sleep(Duration::from_millis(300));
        let out = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .expect("tasklist must run");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            !text.contains(&format!(" {pid} ")),
            "child {pid} should be terminated after drop; tasklist said: {text}"
        );
    }
}
