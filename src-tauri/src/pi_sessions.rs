//! Native Pi 0.84.2 JSONL session catalog.
//!
//! Reads metadata only. Conversation text stays in Pi's files and is never
//! copied into SQLite or Aster app data.

use serde_json::Value;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_SESSION_FILES: usize = 10_000;
pub const MAX_SESSION_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct PiSessionCatalogEntry {
    pub session_id: String,
    pub cwd: PathBuf,
    pub rel_path: PathBuf,
    pub session_name: Option<String>,
    pub created_at: String,
    pub modified_at: String,
    pub message_count: usize,
}

#[derive(Debug)]
pub enum PiCatalogError {
    Io(String),
    LimitExceeded { kind: &'static str, limit: u64 },
    PathEscape,
    ReparsePoint,
    InvalidLocator,
    MissingRoot,
}

impl std::fmt::Display for PiCatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PiCatalogError::Io(msg) => write!(f, "session catalog io: {msg}"),
            PiCatalogError::LimitExceeded { kind, limit } => {
                write!(f, "session catalog {kind} limit exceeded ({limit})")
            }
            PiCatalogError::PathEscape => write!(f, "session path escapes the Pi session root"),
            PiCatalogError::ReparsePoint => {
                write!(f, "session path is a symlink or reparse point")
            }
            PiCatalogError::InvalidLocator => write!(f, "invalid session locator"),
            PiCatalogError::MissingRoot => write!(f, "Pi session root is missing"),
        }
    }
}

impl std::error::Error for PiCatalogError {}

impl From<std::io::Error> for PiCatalogError {
    fn from(e: std::io::Error) -> Self {
        PiCatalogError::Io(e.kind().to_string())
    }
}

/// Pi 0.84.2 stores sessions under `<config>/sessions`.
/// `PI_CODING_AGENT_SESSION_DIR` wins, then `PI_CODING_AGENT_DIR/sessions`,
/// then `%USERPROFILE%/.pi/agent/sessions`.
pub fn default_session_root() -> Result<PathBuf, PiCatalogError> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_SESSION_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed).join("sessions"));
        }
    }
    let home = dirs::home_dir().ok_or(PiCatalogError::MissingRoot)?;
    Ok(home.join(".pi").join("agent").join("sessions"))
}

pub fn scan_session_root(root: &Path) -> Result<Vec<PiSessionCatalogEntry>, PiCatalogError> {
    scan_session_root_with_limits(root, MAX_SESSION_FILES, MAX_SESSION_FILE_BYTES)
}

pub fn scan_session_root_with_limits(
    root: &Path,
    max_files: usize,
    max_file_bytes: u64,
) -> Result<Vec<PiSessionCatalogEntry>, PiCatalogError> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    if is_reparse_or_symlink(root) {
        return Err(PiCatalogError::ReparsePoint);
    }
    if !root.is_dir() {
        return Err(PiCatalogError::Io("session root is not a directory".into()));
    }

    let mut files_seen = 0usize;
    let mut jsonl_paths = Vec::new();
    collect_jsonl_files(root, root, &mut files_seen, max_files, &mut jsonl_paths)?;

    let mut entries = Vec::new();
    for path in jsonl_paths {
        let meta = fs::symlink_metadata(&path)?;
        if is_reparse_from_meta(&meta) {
            return Err(PiCatalogError::ReparsePoint);
        }
        if meta.len() > max_file_bytes {
            return Err(PiCatalogError::LimitExceeded {
                kind: "file size",
                limit: max_file_bytes,
            });
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| PiCatalogError::PathEscape)?
            .to_path_buf();
        if locator_escapes(&rel) {
            return Err(PiCatalogError::PathEscape);
        }
        if let Some(entry) = parse_session_metadata(&path, rel, meta.modified().ok())? {
            entries.push(entry);
        }
    }
    Ok(entries)
}

pub fn resolve_session_path(root: &Path, rel_path: &str) -> Result<PathBuf, PiCatalogError> {
    if rel_path.trim().is_empty() {
        return Err(PiCatalogError::InvalidLocator);
    }
    let rel = PathBuf::from(rel_path.replace('/', "\\"));
    if locator_escapes(&rel) {
        return Err(PiCatalogError::PathEscape);
    }
    let joined = root.join(&rel);
    if is_reparse_or_symlink(&joined) {
        return Err(PiCatalogError::ReparsePoint);
    }
    let root_key = normalize_project_path(root);
    let joined_key = normalize_project_path(&joined);
    if !path_key_is_within(&root_key, &joined_key) {
        return Err(PiCatalogError::PathEscape);
    }
    if !joined.is_file() {
        return Err(PiCatalogError::InvalidLocator);
    }
    Ok(joined)
}

/// Case-insensitive, slash-normalized identity. Canonicalize when the path exists.
pub fn normalize_project_path(path: &Path) -> String {
    let resolved = if path.exists() && !is_reparse_or_symlink(path) {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };
    let mut s = resolved.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    s.trim_end_matches('\\').to_string()
}

pub fn project_paths_equal(a: &Path, b: &Path) -> bool {
    normalize_project_path(a).eq_ignore_ascii_case(&normalize_project_path(b))
}

fn path_key_is_within(root_key: &str, candidate_key: &str) -> bool {
    let root = root_key.trim_end_matches('\\');
    let cand = candidate_key.trim_end_matches('\\');
    if cand.eq_ignore_ascii_case(root) {
        return true;
    }
    let prefix = format!("{root}\\");
    cand.len() > prefix.len() && cand[..prefix.len()].eq_ignore_ascii_case(&prefix)
}

fn collect_jsonl_files(
    root: &Path,
    dir: &Path,
    files_seen: &mut usize,
    max_files: usize,
    out: &mut Vec<PathBuf>,
) -> Result<(), PiCatalogError> {
    if is_reparse_or_symlink(dir) {
        return Err(PiCatalogError::ReparsePoint);
    }
    let read = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => return Err(PiCatalogError::Io(e.kind().to_string())),
    };
    let mut subdirs = Vec::new();
    for entry in read {
        let entry = entry?;
        let path = entry.path();
        if is_reparse_or_symlink(&path) {
            return Err(PiCatalogError::ReparsePoint);
        }
        let ft = entry.file_type()?;
        if ft.is_dir() {
            subdirs.push(path);
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let is_jsonl = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false);
        if !is_jsonl {
            continue;
        }
        *files_seen += 1;
        if *files_seen > max_files {
            return Err(PiCatalogError::LimitExceeded {
                kind: "file count",
                limit: max_files as u64,
            });
        }
        if path.strip_prefix(root).is_err() {
            return Err(PiCatalogError::PathEscape);
        }
        out.push(path);
    }
    for sub in subdirs {
        collect_jsonl_files(root, &sub, files_seen, max_files, out)?;
    }
    Ok(())
}

fn parse_session_metadata(
    path: &Path,
    rel: PathBuf,
    modified: Option<SystemTime>,
) -> Result<Option<PiSessionCatalogEntry>, PiCatalogError> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut header: Option<Value> = None;
    let mut session_name: Option<String> = None;
    let mut message_count = 0usize;

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let typ = value.get("type").and_then(Value::as_str).unwrap_or("");
        if header.is_none() {
            if typ != "session" {
                return Ok(None);
            }
            header = Some(value);
            continue;
        }
        match typ {
            "session_info" => {
                if let Some(name) = value.get("name").and_then(Value::as_str) {
                    let trimmed_name = name.trim();
                    if !trimmed_name.is_empty() {
                        session_name = Some(trimmed_name.to_string());
                    }
                }
            }
            "message" => message_count += 1,
            _ => {}
        }
    }

    let Some(header) = header else {
        return Ok(None);
    };
    let Some(session_id) = header
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
    else {
        return Ok(None);
    };
    let Some(cwd) = header
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
    else {
        return Ok(None);
    };
    let created_at = header
        .get("timestamp")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".into());
    let modified_at = modified
        .and_then(system_time_rfc3339)
        .unwrap_or_else(|| created_at.clone());

    Ok(Some(PiSessionCatalogEntry {
        session_id,
        cwd,
        rel_path: rel,
        session_name,
        created_at,
        modified_at,
        message_count,
    }))
}

fn system_time_rfc3339(ts: SystemTime) -> Option<String> {
    let secs = ts.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    chrono::DateTime::from_timestamp(secs, 0).map(|dt| dt.to_rfc3339())
}

fn locator_escapes(rel: &Path) -> bool {
    if rel.is_absolute() {
        return true;
    }
    rel.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    })
}

fn is_reparse_or_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| is_reparse_from_meta(&m))
        .unwrap_or(false)
}

fn is_reparse_from_meta(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        false
    }
}
