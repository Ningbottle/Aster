//! PiConnector（M1）：严格 JSONL RPC 会话（content.md §6）。
//!
//! 只通过 `pi --mode rpc` 的 stdin/stdout JSONL 与 Pi 交互，不存在第二种
//! Pi 接入路线。协议事实来自 0.84.2 的真实采集 fixtures
//! （`fixtures/pi-rpc/*.jsonl`），以 fixture 为 contract，不依赖上游仓库
//! 实时状态。
//!
//! 实现说明：
//! - 请求/响应用 id 关联，`request()` 带超时等待响应；
//! - 事件（message_update / tool_execution_* / agent_* 等）通过回调推送；
//! - `abort` 的响应行在真实 0.84.2 中不保证出现，取消的确认以
//!   `agent_end` + `agent_settled` 事件为准（见 cancel fixture）；
//! - 输出流在 `agent_settled` 之前终止 => 进程异常退出（见 crash fixture）。

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// M1 深验证锁定的 Pi 版本。
pub const LOCKED_PI_VERSION: &str = "0.84.2";

#[derive(Debug, Clone, Serialize)]
pub struct PiRuntime {
    pub version: String,
    pub cli_js: String,
    pub managed: bool,
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

/// 发现 Pi 安装：Aster-managed（runtimes/pi/<v>/...）与外部 npm 全局安装。
pub fn discover(app_data_root: &Path) -> Vec<PiRuntime> {
    let mut found = Vec::new();
    let runtimes = app_data_root.join("runtimes").join("pi");
    if let Ok(entries) = std::fs::read_dir(&runtimes) {
        for entry in entries.flatten() {
            let cli = entry
                .path()
                .join("node_modules")
                .join("@earendil-works")
                .join("pi-coding-agent")
                .join("dist")
                .join("cli.js");
            if cli.is_file() {
                found.push(PiRuntime {
                    version: entry.file_name().to_string_lossy().to_string(),
                    cli_js: cli.to_string_lossy().to_string(),
                    managed: true,
                });
            }
        }
    }
    // 外部 npm 全局安装（pi.cmd 由 npm 生成）
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let shim = PathBuf::from(&appdata).join("npm").join("pi.cmd");
        if shim.is_file() {
            if let Some(ver) = probe_external_version(&shim) {
                // npm 全局布局：<appdata>/npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
                let cli = PathBuf::from(&appdata)
                    .join("npm")
                    .join("node_modules")
                    .join("@earendil-works")
                    .join("pi-coding-agent")
                    .join("dist")
                    .join("cli.js");
                if cli.is_file() {
                    found.push(PiRuntime {
                        version: ver,
                        cli_js: cli.to_string_lossy().to_string(),
                        managed: false,
                    });
                }
            }
        }
    }
    found.sort_by_key(|b| std::cmp::Reverse(version_key(&b.version)));
    found
}

/// 安装 Aster-managed Pi 运行时到 runtimes/pi/<version>。
pub fn install_managed(app_data_root: &Path, version: &str) -> Result<PiRuntime, String> {
    if !crate::supervisor::is_safe_version(version) {
        return Err(format!("invalid version string: {version}"));
    }
    let target_dir = app_data_root.join("runtimes").join("pi").join(version);
    let cli = target_dir
        .join("node_modules")
        .join("@earendil-works")
        .join("pi-coding-agent")
        .join("dist")
        .join("cli.js");

    if cli.is_file() {
        return Ok(PiRuntime {
            version: version.to_string(),
            cli_js: cli.to_string_lossy().to_string(),
            managed: true,
        });
    }

    std::fs::create_dir_all(&target_dir).map_err(|e| format!("create runtime dir failed: {e}"))?;

    let pkg_spec = format!("@earendil-works/pi-coding-agent@{version}");
    let out = Command::new("cmd")
        .args([
            "/C",
            "npm",
            "install",
            "--no-audit",
            "--no-fund",
            "--prefix",
            &target_dir.to_string_lossy(),
            &pkg_spec,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("failed to invoke npm: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("npm install {pkg_spec} failed: {err}"));
    }

    if !cli.is_file() {
        return Err(format!(
            "npm install succeeded but cli.js not found at {}",
            cli.display()
        ));
    }

    Ok(PiRuntime {
        version: version.to_string(),
        cli_js: cli.to_string_lossy().to_string(),
        managed: true,
    })
}

fn probe_external_version(shim: &Path) -> Option<String> {
    let out = Command::new("cmd")
        .args(["/C", &shim.to_string_lossy(), "--version"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let first_line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if crate::supervisor::is_safe_version(&first_line) { Some(first_line) } else { None }
}

/// 解析后的服务端行。
#[derive(Debug, Clone, PartialEq)]
pub enum ServerLine {
    /// type == "response" 的命令响应
    Response {
        id: Option<String>,
        command: String,
        success: bool,
        error: Option<String>,
    },
    /// 其他所有事件行（保留 type 与原始 JSON）
    Event { event_type: String, raw: Value },
}

/// 严格 JSONL 解析：仅以 \n 分帧，容忍末尾 \r；解析失败返回 None。
pub fn parse_server_line(line: &str) -> Option<ServerLine> {
    let trimmed = line.strip_suffix('\r').unwrap_or(line);
    if trimmed.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(trimmed).ok()?;
    if v.get("type").and_then(Value::as_str) == Some("response") {
        Some(ServerLine::Response {
            id: v.get("id").and_then(Value::as_str).map(str::to_string),
            command: v
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            success: v.get("success").and_then(Value::as_bool).unwrap_or(false),
            error: v.get("error").and_then(Value::as_str).map(str::to_string),
        })
    } else {
        Some(ServerLine::Event {
            event_type: v
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            raw: v,
        })
    }
}

/// 会话事件摘要与原始内容（推送给 UI / 测试断言）。
#[derive(Debug, Clone, Serialize)]
pub struct SessionEvent {
    pub event_type: String,
    pub summary: String,
    pub raw: Value,
}

/// 折叠观察到的会话状态（fixture 测试与运行时共用）。
#[derive(Debug, Default, Clone)]
pub struct SessionObservation {
    pub tool_starts: usize,
    pub tool_ends: usize,
    pub tool_names: Vec<String>,
    pub message_updates: usize,
    pub agent_ends: usize,
    pub settled: bool,
    pub protocol_errors: Vec<String>,
    pub abort_requested: bool,
}

impl SessionObservation {
    pub fn observe(&mut self, line: &ServerLine) {
        match line {
            ServerLine::Response { command, success, error, .. } => {
                if !success {
                    self.protocol_errors
                        .push(format!("{command}: {}", error.clone().unwrap_or_default()));
                }
            }
            ServerLine::Event { event_type, raw } => match event_type.as_str() {
                // 新的 agent 回合开始：重置每回合状态。settled/agent_ends/
                // 工具计数是回合内语义，跨 prompt 累积会导致取消确认被
                // 上一回合的旧 settled 值短路。
                "agent_start" => {
                    self.settled = false;
                    self.agent_ends = 0;
                    self.tool_starts = 0;
                    self.tool_ends = 0;
                    self.tool_names.clear();
                }
                "tool_execution_start" => {
                    self.tool_starts += 1;
                    self.tool_names.push(
                        raw.get("toolName")
                            .and_then(Value::as_str)
                            .unwrap_or("?")
                            .to_string(),
                    );
                }
                "tool_execution_end" => self.tool_ends += 1,
                "message_update" => self.message_updates += 1,
                "agent_end" => self.agent_ends += 1,
                "agent_settled" => self.settled = true,
                _ => {}
            },
        }
    }
}


/// 会话观察句柄：持有 PiSession 内部状态的 Arc，可以在不持有会话锁的
/// 情况下等待 settled / 读取观察快照。
pub struct SessionWatcher {
    observation: Arc<Mutex<SessionObservation>>,
    closed: Arc<Mutex<bool>>,
}

impl SessionWatcher {
    pub fn wait_settled(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.observation.lock().unwrap().settled {
                return true;
            }
            if *self.closed.lock().unwrap() {
                return false;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn observation(&self) -> SessionObservation {
        self.observation.lock().unwrap().clone()
    }

    pub fn is_closed(&self) -> bool {
        *self.closed.lock().unwrap()
    }
}

/// 一个活跃的 Pi RPC 会话。
pub struct PiSession {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<Value>>>>,
    observation: Arc<Mutex<SessionObservation>>,
    next_id: Arc<AtomicU64>,
    closed: Arc<Mutex<bool>>,
}

impl PiSession {
    /// 启动 RPC 会话。`config_dir` 为 Some 时使用隔离的 Pi 配置目录
    /// （Aster 测试作用域）；`cwd` 不得是 Pi 自己的包目录（0.84.2 实测
    /// 会在 monorepo 自扫描时挂起，见 M1 spike 记录）。
    pub fn start(
        cli_js: &Path,
        cwd: &Path,
        config_dir: Option<&Path>,
        on_event: impl Fn(SessionEvent) + Send + 'static,
    ) -> std::io::Result<Self> {
        let mut cmd = Command::new("node");
        cmd.arg(cli_js).args(["--mode", "rpc"]).current_dir(cwd);
        if let Some(dir) = config_dir {
            cmd.env("PI_CODING_AGENT_DIR", dir);
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd.spawn()?;

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");

        let pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let observation = Arc::new(Mutex::new(SessionObservation::default()));
        let closed = Arc::new(Mutex::new(false));

        let reader_pending = Arc::clone(&pending);
        let reader_obs = Arc::clone(&observation);
        let reader_closed = Arc::clone(&closed);
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let Some(parsed) = parse_server_line(&line) else { continue };
                if let ServerLine::Response { .. } = &parsed {
                    let obj: Value = serde_json::from_str(
                        line.strip_suffix('\r').unwrap_or(&line),
                    )
                    .unwrap_or(Value::Null);
                    if let Some(id) = obj.get("id").and_then(Value::as_str) {
                        if let Some(tx) = reader_pending.lock().unwrap().remove(id) {
                            let _ = tx.send(obj);
                        }
                    }
                }
                if let ServerLine::Event { event_type, raw } = &parsed {
                    on_event(SessionEvent {
                        event_type: event_type.clone(),
                        summary: summarize_event(event_type, raw),
                        raw: raw.clone(),
                    });
                }
                {
                    let mut obs = reader_obs.lock().unwrap();
                    obs.observe(&parsed);
                }
            }
            *reader_closed.lock().unwrap() = true;
        });

        Ok(Self {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            observation,
            next_id: Arc::new(AtomicU64::new(1)),
            closed,
        })
    }

    pub fn observation(&self) -> SessionObservation {
        self.observation.lock().unwrap().clone()
    }

    pub fn is_closed(&self) -> bool {
        *self.closed.lock().unwrap()
    }

    fn alloc_id(&self) -> String {
        format!("aster-{}", self.next_id.fetch_add(1, Ordering::SeqCst))
    }

    fn send_raw(&self, v: &Value) -> std::io::Result<()> {
        let mut stdin = self.stdin.lock().unwrap();
        stdin.write_all(serde_json::to_string(v)?.as_bytes())?;
        stdin.write_all(b"\n")?;
        stdin.flush()
    }

    /// 发送命令并等待对应 id 的响应。
    pub fn request(&self, mut body: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.alloc_id();
        body["id"] = json!(id);
        let (tx, rx) = std::sync::mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        self.send_raw(&body).map_err(|e| format!("send failed: {e}"))?;
        match rx.recv_timeout(timeout) {
            Ok(v) => Ok(v),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("timed out waiting for response to {body}"))
            }
        }
    }

    /// 查询当前可用模型列表。
    pub fn get_available_models(&self) -> Result<Vec<Value>, String> {
        let resp = self.request(json!({ "type": "get_available_models" }), Duration::from_secs(30))?;
        if resp.get("success").and_then(Value::as_bool) == Some(true) {
            let models = resp
                .get("data")
                .and_then(|d| d.get("models"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            Ok(models)
        } else {
            Err(resp.get("error").and_then(Value::as_str).unwrap_or("get_available_models failed").to_string())
        }
    }

    /// 切换模型。
    pub fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String> {
        let resp = self.request(
            json!({ "type": "set_model", "provider": provider, "modelId": model_id }),
            Duration::from_secs(30),
        )?;
        if resp.get("success").and_then(Value::as_bool) == Some(true) {
            Ok(resp.get("data").cloned().unwrap_or(Value::Null))
        } else {
            Err(resp.get("error").and_then(Value::as_str).unwrap_or("set_model failed").to_string())
        }
    }

    /// 获取会话当前状态（模型、thinkingLevel 等）。
    pub fn get_state(&self) -> Result<Value, String> {
        let resp = self.request(json!({ "type": "get_state" }), Duration::from_secs(30))?;
        if resp.get("success").and_then(Value::as_bool) == Some(true) {
            Ok(resp.get("data").cloned().unwrap_or(Value::Null))
        } else {
            Err(resp.get("error").and_then(Value::as_str).unwrap_or("get_state failed").to_string())
        }
    }

    /// 开启新会话。
    pub fn new_session(&self) -> Result<(), String> {
        let resp = self.request(json!({ "type": "new_session" }), Duration::from_secs(30))?;
        if resp.get("success").and_then(Value::as_bool) == Some(true) {
            Ok(())
        } else {
            Err(resp.get("error").and_then(Value::as_str).unwrap_or("new_session failed").to_string())
        }
    }

    /// 发送 prompt。成功只表示被接受；后续失败通过事件呈现。
    pub fn prompt(&self, message: &str) -> Result<(), String> {
        {
            let mut obs = self.observation.lock().unwrap();
            obs.settled = false;
            obs.abort_requested = false;
        }
        let resp = self.request(
            json!({ "type": "prompt", "message": message }),
            Duration::from_secs(60),
        )?;
        if resp.get("success").and_then(Value::as_bool) == Some(true) {
            Ok(())
        } else {
            Err(resp
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("prompt rejected")
                .to_string())
        }
    }

    /// 请求取消。真实 0.84.2 不保证回显 abort 响应，因此这里只发送请求；
    /// 确认语义由调用方观察 agent_end + agent_settled。
    pub fn abort(&self) -> Result<(), String> {
        self.observation.lock().unwrap().abort_requested = true;
        let body = json!({ "type": "abort" });
        self.send_raw(&body).map_err(|e| format!("send failed: {e}"))
    }

    /// 获取可独立持有的观察句柄，用于在会话锁之外等待状态变化。
    pub fn watcher(&self) -> SessionWatcher {
        SessionWatcher {
            observation: Arc::clone(&self.observation),
            closed: Arc::clone(&self.closed),
        }
    }

    /// 等待 agent_settled（带超时）。
    pub fn wait_settled(&self, timeout: Duration) -> bool {
        self.watcher().wait_settled(timeout)
    }

    /// 停止会话进程树。
    pub fn stop(&mut self) -> std::io::Result<()> {
        crate::supervisor::kill_process_tree(self.child.id())
    }
}

impl Drop for PiSession {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn summarize_event(event_type: &str, raw: &Value) -> String {
    match event_type {
        "tool_execution_start" => format!(
            "tool start: {}",
            raw.get("toolName").and_then(Value::as_str).unwrap_or("?")
        ),
        "tool_execution_end" => format!(
            "tool end: {} isError={}",
            raw.get("toolName").and_then(Value::as_str).unwrap_or("?"),
            raw.get("isError").and_then(Value::as_bool).unwrap_or(false)
        ),
        "message_update" => {
            let ev = raw.get("assistantMessageEvent");
            match ev.and_then(|e| e.get("type")).and_then(Value::as_str) {
                Some("text_delta") => {
                    let delta = ev
                        .and_then(|e| e.get("delta"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    format!("text: {delta}")
                }
                Some(k) => k.to_string(),
                None => "update".to_string(),
            }
        }
        "agent_settled" => "agent settled".to_string(),
        "agent_end" => "agent ended".to_string(),
        _ => event_type.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_fixture(name: &str) -> Vec<String> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join("pi-rpc")
            .join(name);
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn observe_fixture(name: &str) -> SessionObservation {
        let mut obs = SessionObservation::default();
        for line in load_fixture(name) {
            if let Some(parsed) = parse_server_line(&line) {
                obs.observe(&parsed);
            }
        }
        obs
    }

    #[test]
    fn normal_fixture_shows_streaming_tools_and_settled() {
        let obs = observe_fixture("normal.jsonl");
        assert!(obs.message_updates > 10, "应有大量流式 message_update，实际 {}", obs.message_updates);
        assert!(obs.tool_starts >= 1);
        assert_eq!(obs.tool_starts, obs.tool_ends);
        assert!(obs.tool_names.iter().any(|t| t == "bash"), "{:?}", obs.tool_names);
        assert!(obs.settled, "正常会话必须以 agent_settled 结束");
        assert!(obs.protocol_errors.is_empty(), "{:?}", obs.protocol_errors);
    }

    #[test]
    fn cancel_fixture_shows_early_end_without_error() {
        let obs = observe_fixture("cancel.jsonl");
        assert!(obs.settled, "取消后仍应 settled");
        assert_eq!(obs.agent_ends, 1);
        assert!(obs.protocol_errors.is_empty(), "{:?}", obs.protocol_errors);
        // 取消 fixture 的计数任务被中止：远少于正常完成 30 步所需的工具调用
        assert!(obs.tool_starts < 30, "{}", obs.tool_starts);
    }

    #[test]
    fn error_fixture_collects_protocol_errors() {
        let obs = observe_fixture("error.jsonl");
        assert_eq!(obs.protocol_errors.len(), 3, "{:?}", obs.protocol_errors);
        assert!(obs.protocol_errors.iter().any(|e| e.contains("Unknown command")));
        assert!(obs.protocol_errors.iter().any(|e| e.contains("No API key")));
        assert!(obs.protocol_errors.iter().any(|e| e.contains("Model not found")));
        assert!(!obs.settled);
    }

    #[test]
    fn crash_fixture_ends_without_settled() {
        let obs = observe_fixture("crash.jsonl");
        assert!(!obs.settled, "进程被杀后流终止，不得出现 settled");
        assert!(obs.message_updates > 0, "崩溃前应有部分流式事件");
    }

    #[test]
    fn parse_is_strict_jsonl() {
        assert!(parse_server_line("").is_none());
        assert!(parse_server_line("not json").is_none());
        let resp = parse_server_line("{\"type\":\"response\",\"command\":\"abort\",\"success\":true}\r\n").unwrap();
        assert_eq!(
            resp,
            ServerLine::Response {
                id: None,
                command: "abort".into(),
                success: true,
                error: None
            }
        );
        // U+2028/U+2029 是合法 JSON 字符串内容，不得被当作分隔符处理出错
        let line = "{\"type\":\"x\",\"v\":\"a\u{2028}b\"}";
        assert!(parse_server_line(line).is_some());
    }
}
