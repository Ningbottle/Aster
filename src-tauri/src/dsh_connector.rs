//! DshConnector（M2）：DeepSeek Harness 宿主连接器（content.md §7）。
//!
//! Aster Alpha 优先承载 DSH 原生 Web UI，而不是重新实现对话与模式系统。
//! DSH 拥有独立的工作区、插件系统、自定义模式与会话持久化。
//!
//! 本连接器负责：
//! - 发现 Aster-managed（runtimes/dsh/<v>/...）与外部 DSH 安装（只读，无副作用）；
//! - 安装锁定版本的 DSH 运行时（版本字符串严格校验）；
//! - 动态分配 localhost 端口并检测冲突；
//! - 启动 DSH Web 服务进程（runner 只写入 Aster 管理目录；外部安装通过
//!   Aster 管理的 shim 目录 + node_modules junction 解析模块，绝不写入
//!   用户的 npm 全局目录）；
//! - HTTP 就绪健康检查（校验响应体标记，避免误认同端口的无关服务）；
//! - 基于进程存活探测的运行状态与 `Drop` 自动终结进程树。

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

/// 健康探针在响应体中查找的标记（Aster runner 的 fallback 页面包含它），
/// 用于确认端口上响应的是我们的 DSH 服务而非恰好占用端口的无关进程。
const HEALTH_MARKER: &str = "DeepSeek Harness";

#[derive(Debug, Clone, Serialize)]
pub struct DshRuntime {
    pub version: String,
    /// server.mjs runner 路径（启动时才写入，见 prepare_runner）。
    pub entry_path: String,
    /// ESM 模块解析用的 node_modules 来源（外部安装为全局 npm node_modules）。
    pub node_modules_source: String,
    pub managed: bool,
    pub supported: bool,
}

const RUNNER_CODE: &str = r#"import { Context, Service } from '@deepseek-ai/cordis';
import { WebServer } from '@deepseek-ai/dsh-host-webserver';

const port = Number(process.env.PORT || 38472);
const host = process.env.HOST || '127.0.0.1';

const ctx = new Context();
const server = new WebServer(ctx, { port, host });
await server[Service.init]();

server.registerFallback((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html><head><title>DeepSeek Harness</title><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:2rem;"><h1>DeepSeek Harness Native Web UI</h1><p>Running under Aster on port ' + port + '</p></body></html>');
});

console.log(`[DSH] WebServer listening on http://${host}:${server.port}`);
setInterval(() => {}, 60000);
"#;

/// 准备 runner：只在 Aster 管理目录内写文件。
/// - managed 安装：runner 写入 runtimes/dsh/<v>/（npm --prefix 已在此放好 node_modules）；
/// - 外部安装：runner 写入 runtimes/dsh/_external/<v>/，并在其中创建
///   node_modules junction 指向全局 npm 的 node_modules（ESM 裸导入经
///   junction 解析；junction 是指向外部的链接，不修改外部目录本身）。
fn prepare_runner(app_data_root: &Path, runtime: &DshRuntime) -> Result<PathBuf, String> {
    let runner_dir = if runtime.managed {
        Path::new(&runtime.entry_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| app_data_root.join("runtimes").join("dsh").join(&runtime.version))
    } else {
        let shim = app_data_root
            .join("runtimes")
            .join("dsh")
            .join("_external")
            .join(&runtime.version);
        // 为 ESM 解析准备 node_modules junction（幂等）
        let link = shim.join("node_modules");
        if !link.exists() {
            let source = PathBuf::from(&runtime.node_modules_source);
            if !source.is_dir() {
                return Err(format!(
                    "external DSH module source not found: {} (was the global install removed?)",
                    source.display()
                ));
            }
            junction::create(&source, &link)
                .map_err(|e| format!("create node_modules junction {} -> {}: {e}", link.display(), source.display()))?;
        }
        shim
    };
    let runner = runner_dir.join("server.mjs");
    std::fs::create_dir_all(&runner_dir).map_err(|e| format!("create runner dir {}: {e}", runner_dir.display()))?;
    std::fs::write(&runner, RUNNER_CODE).map_err(|e| format!("write runner {}: {e}", runner.display()))?;
    Ok(runner)
}

/// 发现 DSH 安装：Aster-managed（runtimes/dsh/<v>/...）与外部 npm 全局安装。
/// 只读操作：不向任何目录写入（runner 在启动时才准备）。
pub fn discover(app_data_root: &Path) -> Vec<DshRuntime> {
    let mut found = Vec::new();
    let runtimes = app_data_root.join("runtimes").join("dsh");
    if let Ok(entries) = std::fs::read_dir(&runtimes) {
        for entry in entries.flatten() {
            let pkg_dir = entry
                .path()
                .join("node_modules")
                .join("@deepseek-ai")
                .join("dsh-web-app");
            let entry_file = pkg_dir.join("lib").join("index.js");
            if entry_file.is_file() {
                let ver = entry.file_name().to_string_lossy().to_string();
                let supported = ver == LOCKED_DSH_VERSION;
                found.push(DshRuntime {
                    version: ver.clone(),
                    entry_path: entry.path().join("server.mjs").to_string_lossy().to_string(),
                    node_modules_source: String::new(),
                    managed: true,
                    supported,
                });
            }
        }
    }

    // 外部 npm 全局安装：只读探测，runner 路径指向 Aster 管理的 shim
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let global_node_modules = PathBuf::from(&appdata).join("npm").join("node_modules");
        let global_dsh = global_node_modules.join("@deepseek-ai").join("dsh-web-app");
        if global_dsh.join("lib").join("index.js").is_file() {
            let pkg_json = global_dsh.join("package.json");
            let ver = read_version_from_pkg_json(&pkg_json).unwrap_or_else(|| "unknown".into());
            let supported = ver == LOCKED_DSH_VERSION;
            let shim_entry = app_data_root
                .join("runtimes")
                .join("dsh")
                .join("_external")
                .join(&ver)
                .join("server.mjs");
            found.push(DshRuntime {
                version: ver,
                entry_path: shim_entry.to_string_lossy().to_string(),
                node_modules_source: global_node_modules.to_string_lossy().to_string(),
                managed: false,
                supported,
            });
        }
    }

    found.sort_by_key(|b| std::cmp::Reverse(version_key(&b.version)));
    found
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
    val.get("version").and_then(|v| v.as_str()).map(str::to_string)
}

/// 安装 Aster-managed DSH 运行时到 runtimes/dsh/<version>。
pub fn install_managed(app_data_root: &Path, version: &str) -> Result<DshRuntime, String> {
    if !crate::supervisor::is_safe_version(version) {
        return Err(format!("invalid version string: {version}"));
    }
    let target_dir = app_data_root.join("runtimes").join("dsh").join(version);
    // 目标目录已存在且非空但不是 DSH 安装布局时拒绝写入（不覆盖未知内容）
    if target_dir.exists()
        && std::fs::read_dir(&target_dir).map(|d| d.count() > 0).unwrap_or(false)
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
        .join("dsh-web-app")
        .join("lib")
        .join("index.js");

    if !entry_file.is_file() {
        std::fs::create_dir_all(&target_dir).map_err(|e| format!("create runtime dir failed: {e}"))?;

        // 版本已通过 is_safe_version 校验（仅数字/点/连字符），prefix 路径
        // 来自 Aster 自身布局；再防御性拒绝含 cmd 元字符的路径。
        let dir_str = target_dir.to_string_lossy().to_string();
        if ['&', '|', '^', '<', '>', '(', ')', '%', '!', '"', '\''].iter().any(|c| dir_str.contains(*c)) {
            return Err(format!("runtime dir path contains shell metacharacters: {dir_str}"));
        }

        let pkg_spec = format!("@deepseek-ai/dsh-web-app@{version}");
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
        entry_path: target_dir.join("server.mjs").to_string_lossy().to_string(),
        node_modules_source: String::new(),
        managed: true,
        supported: version == LOCKED_DSH_VERSION,
    })
}

/// 查找 127.0.0.1 上可用的 TCP 端口（从 start_port 起尝试最多 100 个端口）。
pub fn find_available_port(start_port: u16) -> Option<u16> {
    (start_port..start_port.saturating_add(100)).find(|&p| TcpListener::bind(("127.0.0.1", p)).is_ok())
}

/// DSH 运行状态视图。
#[derive(Debug, Clone, Serialize)]
pub struct DshStatus {
    pub running: bool,
    pub healthy: bool,
    pub port: u16,
    pub url: String,
    pub version: String,
    pub managed: bool,
    pub pid: Option<u32>,
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
    /// 启动 DSH Web 服务进程，并等待 HTTP 健康探针就绪。
    pub fn start(
        app_data_root: &Path,
        runtime: &DshRuntime,
        workspace: &Path,
        config_dir: Option<&Path>,
        preferred_port: u16,
    ) -> Result<Self, String> {
        let runner = prepare_runner(app_data_root, runtime)?;
        let runner_dir = runner.parent().map(Path::to_path_buf).unwrap_or_else(|| workspace.to_path_buf());

        let port = find_available_port(preferred_port)
            .ok_or_else(|| format!("no available port starting from {preferred_port}"))?;
        let url = format!("http://127.0.0.1:{port}");

        std::fs::create_dir_all(workspace).map_err(|e| format!("create workspace dir: {e}"))?;

        let mut cmd = Command::new("node");
        cmd.arg(&runner)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .env("DSH_WORKSPACE", workspace)
            .current_dir(&runner_dir);

        if let Some(dir) = config_dir {
            cmd.env("DSH_CONFIG_DIR", dir);
        }

        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = cmd.spawn().map_err(|e| format!("spawn DSH process failed: {e}"))?;

        let server = Self {
            child: Arc::new(Mutex::new(child)),
            port,
            url,
            version: runtime.version.clone(),
            managed: runtime.managed,
            stopped: Arc::new(AtomicBool::new(false)),
        };

        // 等待服务健康检查就绪（最多 25 秒）
        if !server.wait_ready(Duration::from_secs(25)) {
            let stderr_hint = server.child_exited();
            let mut s = server;
            let _ = s.stop();
            return Err(if stderr_hint {
                format!(
                    "DSH process exited before becoming healthy at http://127.0.0.1:{port}; \
                     check runner/module resolution under {}",
                    runner_dir.display()
                )
            } else {
                format!("DSH service failed to pass health check at http://127.0.0.1:{port} within 25s")
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

    /// 单次 HTTP GET 探测：必须 200 且响应体含 DSH 标记，
    /// 防止把恰好占用端口的无关本地服务误判为 DSH。
    pub fn probe_healthy(&self) -> bool {
        if self.is_stopped() || self.child_exited() {
            return false;
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_millis(500))
            .timeout_read(Duration::from_millis(1000))
            .build();
        let resp = match agent.get(&self.url).call() {
            Ok(resp) => resp,
            Err(_) => return false,
        };
        if resp.status() != 200 {
            return false;
        }
        let mut body = String::new();
        let reader = resp.into_reader();
        let mut limited = reader.take(4096);
        if limited.read_to_string(&mut body).is_err() {
            return false;
        }
        body.contains(HEALTH_MARKER)
    }

    /// 轮询等待就绪。
    pub fn wait_ready(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.probe_healthy() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        false
    }

    pub fn status(&self) -> DshStatus {
        let healthy = self.probe_healthy();
        // running 同时要求：未主动停止 && 子进程仍存活 && 健康探针可达
        let running = !self.is_stopped() && !self.child_exited();
        DshStatus {
            running,
            healthy,
            port: self.port,
            url: self.url.clone(),
            version: self.version.clone(),
            managed: self.managed,
            pid: if running { Some(self.pid()) } else { None },
        }
    }

    /// 终止 DSH 进程树。
    pub fn stop(&mut self) -> io::Result<()> {
        if self.stopped.swap(true, Ordering::SeqCst) {
            return Ok(()); // 已停止过
        }
        crate::supervisor::kill_process_tree(self.pid())
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
