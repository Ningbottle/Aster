//! Catalog and runtime binding tests for native Pi sessions.

use aster_lib::pi_sessions::{
    resolve_session_path, scan_session_root, scan_session_root_with_limits, PiCatalogError,
    MAX_SESSION_FILES, MAX_SESSION_FILE_BYTES,
};
use std::fs;
use std::path::Path;

const VALID_SESSION: &str = concat!(
    r#"{"type":"session","version":3,"id":"s-1","timestamp":"2026-08-19T00:00:00Z","cwd":"C:/fixture/project-a"}"#,
    "\n",
    r#"{"type":"session_info","id":"e-1","parentId":null,"timestamp":"2026-08-19T00:00:01Z","name":"Plan compiler"}"#,
    "\n",
    r#"{"type":"message","id":"e-2","parentId":"e-1","timestamp":"2026-08-19T00:00:02Z","message":{"role":"user","content":"not persisted by Aster"}}"#,
    "\n",
);

fn write_jsonl(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

#[test]
fn catalog_indexes_valid_native_session_metadata() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_jsonl(root, "cwd-a/s-1.jsonl", VALID_SESSION);

    let entries = scan_session_root(root).unwrap();
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.session_id, "s-1");
    assert_eq!(entry.cwd, Path::new("C:/fixture/project-a"));
    assert_eq!(entry.rel_path, Path::new("cwd-a/s-1.jsonl"));
    assert_eq!(entry.session_name.as_deref(), Some("Plan compiler"));
    assert_eq!(entry.message_count, 1);
    assert_eq!(entry.created_at, "2026-08-19T00:00:00Z");
    let debug = format!("{entry:?}");
    assert!(
        !debug.contains("not persisted by Aster"),
        "catalog must not retain message text"
    );
}

#[test]
fn catalog_skips_malformed_header() {
    let tmp = tempfile::tempdir().unwrap();
    write_jsonl(tmp.path(), "bad.jsonl", "{\"type\":\"nope\"}\n");
    let entries = scan_session_root(tmp.path()).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn catalog_skips_missing_cwd() {
    let tmp = tempfile::tempdir().unwrap();
    write_jsonl(
        tmp.path(),
        "no-cwd.jsonl",
        r#"{"type":"session","version":3,"id":"s-x","timestamp":"2026-08-19T00:00:00Z"}
"#,
    );
    let entries = scan_session_root(tmp.path()).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn catalog_oversized_file_returns_limit_exceeded() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("huge.jsonl");
    let f = fs::File::create(&path).unwrap();
    f.set_len(MAX_SESSION_FILE_BYTES + 1).unwrap();
    drop(f);
    let err = scan_session_root(tmp.path()).unwrap_err();
    match err {
        PiCatalogError::LimitExceeded { kind, limit } => {
            assert_eq!(kind, "file size");
            assert_eq!(limit, MAX_SESSION_FILE_BYTES);
        }
        other => panic!("expected size limit, got {other}"),
    }
}

#[test]
fn catalog_too_many_files_returns_limit_exceeded() {
    let tmp = tempfile::tempdir().unwrap();
    write_jsonl(tmp.path(), "a.jsonl", VALID_SESSION);
    write_jsonl(tmp.path(), "b.jsonl", VALID_SESSION);
    write_jsonl(tmp.path(), "c.jsonl", VALID_SESSION);
    let err = scan_session_root_with_limits(tmp.path(), 2, MAX_SESSION_FILE_BYTES).unwrap_err();
    match err {
        PiCatalogError::LimitExceeded { kind, limit } => {
            assert_eq!(kind, "file count");
            assert_eq!(limit, 2);
        }
        other => panic!("expected file count limit, got {other}"),
    }
    assert_eq!(MAX_SESSION_FILES, 10_000);
}

#[test]
fn catalog_rejects_reparse_point() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("root");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    write_jsonl(&outside, "secret.jsonl", VALID_SESSION);
    let link = root.join("escape");
    junction::create(&outside, &link).expect("create junction for catalog test");
    let err = scan_session_root(&root).unwrap_err();
    assert!(
        matches!(err, PiCatalogError::ReparsePoint),
        "reparse points must be rejected, got {err}"
    );
}

#[test]
fn catalog_resolve_rejects_traversal() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    write_jsonl(tmp.path(), "escape.jsonl", VALID_SESSION);
    let err = resolve_session_path(&root, r"..\escape.jsonl").unwrap_err();
    assert!(
        matches!(
            err,
            PiCatalogError::PathEscape | PiCatalogError::InvalidLocator
        ),
        "traversal must be rejected, got {err}"
    );
}
