//! 结构化 JSONL 日志与脱敏（content.md §11）。
//!
//! 任何文本进入日志前必须经过 [`redact`]。禁止记录：密钥、authorization
//! header、环境变量值、对话原文、用户名和原始绝对路径。M0 实现并测试其中
//! 可机械识别的子集；日志限量保留（rotation）留待后续里程碑。

use serde_json::json;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const TOKEN: &str = "<redacted>";

/// 将文本中的敏感内容替换为稳定令牌。纯函数，无 I/O。
/// 只做保守的机械识别；宁可多脱敏，不可漏脱敏。
pub fn redact(input: &str) -> String {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    ranges.extend(user_path_ranges(input));
    ranges.extend(authorization_ranges(input));
    ranges.extend(token_shape_ranges(input));
    ranges.extend(secret_env_ranges(input));

    ranges.sort();
    let mut out = String::with_capacity(input.len());
    let mut prev = 0;
    for (start, end) in ranges {
        if start < prev {
            continue; // 与已替换区间重叠
        }
        out.push_str(&input[prev..start]);
        out.push_str(TOKEN);
        prev = end;
    }
    out.push_str(&input[prev..]);
    out
}

/// ASCII 大小写不敏感查找。needle 必须是纯 ASCII，返回字节偏移。
/// 非 ASCII 字节不会误匹配，因此偏移落在字符边界上。
fn find_ascii_ci(hay: &str, needle: &str, from: usize) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || from >= h.len() || h.len() - from < n.len() {
        return None;
    }
    (from..=h.len() - n.len()).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

fn is_delimiter(b: u8) -> bool {
    matches!(b, b'\\' | b'/' | b'"' | b'\'' | b' ' | b'\t' | b'\r' | b'\n' | b':')
}

/// 保证 end 落在字符边界上（字节扫描可能停在多字节字符中间）。
fn next_boundary(input: &str, mut end: usize) -> usize {
    while end < input.len() && !input.is_char_boundary(end) {
        end += 1;
    }
    end
}

// `C:\Users\<name>\...` / `C:/Users/<name>/...` -> 用户段替换为 `<user>`。
fn user_path_ranges(input: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for sep in ["users\\", "users/"] {
        let mut from = 0;
        while let Some(pos) = find_ascii_ci(input, sep, from) {
            let seg_start = pos + sep.len();
            let bytes = input.as_bytes();
            let mut end = seg_start;
            while end < bytes.len() && !is_delimiter(bytes[end]) {
                end += 1;
            }
            if end > seg_start {
                ranges.push((seg_start, next_boundary(input, end)));
            }
            from = end.max(seg_start);
        }
    }
    ranges
}

// `Authorization: <credentials>` -> 凭据部分替换。值域到行尾或引号。
fn authorization_ranges(input: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let bytes = input.as_bytes();
    let mut from = 0;
    while let Some(pos) = find_ascii_ci(input, "authorization", from) {
        let colon = match bytes[pos..].iter().position(|&b| b == b':') {
            Some(c) if c <= 16 => pos + c, // 冒号应紧跟 header 名
            _ => {
                from = pos + 1;
                continue;
            }
        };
        let mut end = colon + 1;
        while end < bytes.len() && !matches!(bytes[end], b'\r' | b'\n' | b'"') {
            end += 1;
        }
        if end > colon + 1 {
            ranges.push((colon + 1, next_boundary(input, end)));
        }
        from = end.max(colon + 1);
    }
    ranges
}

// 已知令牌形状：sk-、ghp_、gho_、github_pat_ 前缀起的整个令牌替换。
fn token_shape_ranges(input: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for prefix in ["sk-", "ghp_", "gho_", "ghr_", "github_pat_"] {
        let mut from = 0;
        while let Some(pos) = find_ascii_ci(input, prefix, from) {
            let bytes = input.as_bytes();
            let mut end = pos + prefix.len();
            while end < bytes.len()
                && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_' || bytes[end] == b'-')
            {
                end += 1;
            }
            if end > pos + prefix.len() {
                ranges.push((pos, next_boundary(input, end)));
            }
            from = end.max(pos + prefix.len());
        }
    }
    ranges
}

// `KEY=value` 且 KEY 含 secret/token/password/key 时替换值。
fn secret_env_ranges(input: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let bytes = input.as_bytes();
    for pos in 0..bytes.len() {
        if bytes[pos] != b'=' {
            continue;
        }
        let mut key_start = pos;
        while key_start > 0
            && (bytes[key_start - 1].is_ascii_alphanumeric() || bytes[key_start - 1] == b'_')
        {
            key_start -= 1;
        }
        let key = input[key_start..pos].to_ascii_lowercase();
        if !["secret", "token", "password", "key"]
            .iter()
            .any(|s| key.contains(s))
        {
            continue;
        }
        let mut end = pos + 1;
        while end < bytes.len() && !matches!(bytes[end], b'\r' | b'\n' | b' ' | b'\t' | b'"') {
            end += 1;
        }
        if end > pos + 1 {
            ranges.push((pos + 1, next_boundary(input, end)));
        }
    }
    ranges
}

/// 追加式 JSONL 日志文件。每行一个 JSON 对象，message 已脱敏。
pub struct JsonlLogger {
    path: PathBuf,
}

impl JsonlLogger {
    pub fn create(path: impl AsRef<Path>) -> io::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(Self {
            path: path.as_ref().to_path_buf(),
        })
    }

    pub fn log(&self, level: &str, kind: &str, message: &str) -> io::Result<()> {
        let line = json!({
            "ts": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "level": level,
            "kind": kind,
            "message": redact(message),
        });
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(file, "{line}")
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_windows_user_path() {
        assert_eq!(
            redact(r"opened C:\Users\alice\Documents\repo"),
            r"opened C:\Users\<redacted>\Documents\repo"
        );
        assert_eq!(
            redact("read D:/Users/bob/code"),
            "read D:/Users/<redacted>/code"
        );
    }

    #[test]
    fn redacts_authorization_header() {
        let out = redact("Authorization: Bearer abc.def.ghi\r\nnext");
        assert!(!out.contains("abc.def.ghi"), "got: {out}");
        assert!(out.contains(TOKEN));
    }

    #[test]
    fn redacts_known_token_shapes() {
        assert!(!redact("token ghp_0123456789abcdef").contains("0123456789abcdef"));
        assert!(!redact("key sk-proj-XYZsecretVALUE123").contains("XYZsecretVALUE123"));
        assert!(!redact("pat github_pat_22ABCDEFGHIJKLM").contains("ABCDEFGHIJKLM"));
    }

    #[test]
    fn redacts_secret_env_values() {
        let out = redact("MY_API_TOKEN=supersecret1 next");
        assert!(!out.contains("supersecret1"), "got: {out}");
        let out = redact("PATH=C:\\Windows;OTHER=1");
        assert!(out.contains(r"C:\Windows"), "PATH 不应被脱敏: {out}");
    }

    #[test]
    fn leaves_ordinary_text_untouched() {
        let msg = "migrated database to version 1 in 12ms";
        assert_eq!(redact(msg), msg);
    }

    #[test]
    fn logger_writes_redacted_jsonl() {
        let tmp = tempfile::tempdir().unwrap();
        let logger = JsonlLogger::create(tmp.path().join("logs").join("aster.jsonl")).unwrap();
        logger
            .log("info", "startup", r"home is C:\Users\carol, key=sk-abcdef123456")
            .unwrap();

        let content = std::fs::read_to_string(logger.path()).unwrap();
        let value: serde_json::Value = serde_json::from_str(content.trim_end()).unwrap();
        assert_eq!(value["level"], "info");
        assert_eq!(value["kind"], "startup");
        let msg = value["message"].as_str().unwrap();
        assert!(!msg.contains("carol"), "username leaked: {msg}");
        assert!(!msg.contains("abcdef123456"), "token leaked: {msg}");
    }
}
