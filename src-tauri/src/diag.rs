//! 临时运行期稳定性诊断（Runtime Stability 专项审计，2026-08-19）。
//!
//! 只为回答两个问题而存在：
//! 1. 用户点击关闭后，程序停在了哪一步？
//! 2. UI 卡顿期间主线程在等什么？
//!
//! 这不是产品日志系统。审计结束、根因修复并验收后应整体删除，不要在其上
//! 继续叠加功能。因此它刻意保持单文件、无配置、无轮转、无查询接口。
//!
//! 设计约束：
//! - 观察者效应必须小于被测量的现象。写入用持久 fd + 单次 write_all
//!   （约几十微秒），不做 per-line 重新 open（`logging::JsonlLogger` 的
//!   语义），否则测量主线程毫秒级占用时噪声会盖过信号。
//! - 挂起时最后几行才是关键，所以不做用户态缓冲，写完即落 syscall。
//! - 任何失败都静默放弃：诊断不得成为新的故障源。
//! - 文本一律经 [`crate::logging::redact`]，不记录对话原文与凭据。

use serde_json::{json, Value};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

static ENABLED: OnceLock<bool> = OnceLock::new();
static MAIN_THREAD: OnceLock<ThreadId> = OnceLock::new();
static SINK: OnceLock<Option<Mutex<std::fs::File>>> = OnceLock::new();
static STARTED: OnceLock<Instant> = OnceLock::new();

/// 锁等待低于此阈值不记录：只关心真正的争用，不要噪声。
const LOCK_NOISE_FLOOR: Duration = Duration::from_millis(1);
/// pi-event 汇总粒度：逐事件记录会自己变成卡顿源。
const EMIT_ROLLUP_EVERY: u64 = 250;

/// debug 构建默认开启（`npm run tauri dev` 即可产出证据）；
/// release 需显式 `ASTER_DIAG=1`。`ASTER_DIAG=0` 始终关闭。
pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| match std::env::var("ASTER_DIAG") {
        Ok(v) if v == "0" || v.eq_ignore_ascii_case("false") => false,
        Ok(v) if !v.trim().is_empty() => true,
        _ => cfg!(debug_assertions),
    })
}

fn sink() -> Option<&'static Mutex<std::fs::File>> {
    SINK.get_or_init(|| {
        let layout = crate::app_data::AppDataLayout::open_default().ok()?;
        let path = layout.logs.join("diag.jsonl");
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
            .map(Mutex::new)
    })
    .as_ref()
}

/// 必须在主线程最早期调用一次（`run()` 开头），用于后续判定 on_main。
pub fn init_main_thread() {
    if !enabled() {
        return;
    }
    let _ = MAIN_THREAD.set(std::thread::current().id());
    let _ = STARTED.set(Instant::now());
    record(
        "startup",
        json!({
            "pid": std::process::id(),
            "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        }),
    );
}

fn is_main_thread() -> bool {
    MAIN_THREAD
        .get()
        .is_some_and(|id| *id == std::thread::current().id())
}

/// 写一条诊断记录。`kind` 是稳定的事件类别，`detail` 是该类别的字段。
pub fn record(kind: &str, detail: Value) {
    if !enabled() {
        return;
    }
    let Some(sink) = sink() else { return };
    let line = json!({
        "ts": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "since_start_ms": STARTED.get().map(|t| t.elapsed().as_millis() as u64),
        "thread": format!("{:?}", std::thread::current().id()),
        "thread_name": std::thread::current().name().unwrap_or("").to_string(),
        "on_main": is_main_thread(),
        "kind": kind,
        "detail": detail,
    });
    // 锁中毒时放弃本条，不 panic、不影响被测流程。
    if let Ok(mut file) = sink.lock() {
        let mut buf = line.to_string();
        buf.push('\n');
        let _ = file.write_all(buf.as_bytes());
    }
}

/// 记录一段带持续时间的操作。构造时写 begin，Drop 时写 end + elapsed_ms。
/// Drop 语义保证即使中途 `?` 早退也一定有配对的 end。
pub struct Span {
    kind: &'static str,
    name: String,
    start: Instant,
    note: Option<String>,
}

impl Span {
    /// 给这一段附加结论（成功/失败/超时等），出现在 end 记录里。
    pub fn note(&mut self, note: impl Into<String>) {
        self.note = Some(note.into());
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        record(
            self.kind,
            json!({
                "at": "end",
                "name": self.name,
                "elapsed_ms": self.start.elapsed().as_millis() as u64,
                "note": self.note,
            }),
        );
    }
}

/// 开一个 Span。诊断关闭时返回 None，调用点零开销。
pub fn span(kind: &'static str, name: impl Into<String>) -> Option<Span> {
    if !enabled() {
        return None;
    }
    let name = crate::logging::redact(&name.into());
    record(kind, json!({ "at": "begin", "name": name }));
    Some(Span {
        kind,
        name,
        start: Instant::now(),
        note: None,
    })
}

/// 一次性事件：进程 spawn / exit / kill。
pub fn proc_event(action: &str, host: &str, pid: u32) {
    record(
        "proc",
        json!({ "action": action, "host": host, "pid": pid }),
    );
}

/// 获取 Mutex 并记录等待时长（仅超过噪声阈值时记录）。
/// 用于验证/否证「持锁 → 阻塞 → 另一个 command 等同一把锁」假设。
pub fn lock_wait<'a, T>(
    name: &str,
    mutex: &'a Mutex<T>,
) -> Result<MutexGuard<'a, T>, std::sync::PoisonError<MutexGuard<'a, T>>> {
    if !enabled() {
        return mutex.lock();
    }
    let start = Instant::now();
    let guard = mutex.lock();
    let waited = start.elapsed();
    if waited >= LOCK_NOISE_FLOOR {
        record(
            "lock",
            json!({
                "name": name,
                "wait_ms": waited.as_millis() as u64,
                "poisoned": guard.is_err(),
            }),
        );
    }
    guard
}

/// pi-event 发射速率汇总：证明 emit 队列压力，而不逐事件刷日志。
pub fn emit_tick() {
    if !enabled() {
        return;
    }
    static COUNT: AtomicU64 = AtomicU64::new(0);
    static WINDOW_START: OnceLock<Mutex<Instant>> = OnceLock::new();
    static REENTRANT: AtomicBool = AtomicBool::new(false);

    let n = COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    if n % EMIT_ROLLUP_EVERY != 0 {
        return;
    }
    // 汇总本身不该被重入放大。
    if REENTRANT.swap(true, Ordering::SeqCst) {
        return;
    }
    let window = WINDOW_START.get_or_init(|| Mutex::new(Instant::now()));
    if let Ok(mut start) = window.lock() {
        let elapsed = start.elapsed();
        *start = Instant::now();
        record(
            "emit",
            json!({
                "events": EMIT_ROLLUP_EVERY,
                "window_ms": elapsed.as_millis() as u64,
                "total": n,
            }),
        );
    }
    REENTRANT.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_diag_is_inert() {
        // ASTER_DIAG 未设置且在 test（debug）下默认开启，这里只断言 API 不 panic
        // 且 Span 的 Drop 配对不依赖 sink 是否可用。
        let mut s = span("test", "unit");
        if let Some(span) = s.as_mut() {
            span.note("ok");
        }
        drop(s);
        proc_event("spawn", "test", std::process::id());
        emit_tick();
    }

    #[test]
    fn lock_wait_returns_the_guard() {
        let m = Mutex::new(7u32);
        let guard = lock_wait("test-lock", &m).unwrap();
        assert_eq!(*guard, 7);
    }

    #[test]
    fn span_name_is_redacted() {
        // Span 名可能含路径，必须经过 redact 才落盘。
        let s = span("test", r"C:\Users\someone\proj");
        if let Some(span) = &s {
            assert!(!span.name.contains("someone"), "{}", span.name);
        }
    }
}
