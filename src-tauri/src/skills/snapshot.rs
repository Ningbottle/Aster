use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use chrono::Utc;
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use super::source::SkillSource;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: String,
    pub skill_name: String,
    pub root_dir: PathBuf,
    pub file_count: usize,
    pub content_sha: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffDetail {
    pub path: String,
    pub status: String, // "added" | "deleted" | "modified" | "identical"
    pub diff_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotDiff {
    pub base_snapshot_id: String,
    pub head_snapshot_id: String,
    pub added_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub modified_files: Vec<String>,
    pub identical_files: Vec<String>,
    pub file_diffs: Vec<FileDiffDetail>,
}

pub fn collect_files(root: &Path) -> io::Result<Vec<(String, PathBuf)>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let ft = entry.file_type()?;
            if ft.is_dir() {
                stack.push(path);
            } else {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, path));
            }
        }
    }
    Ok(out)
}

/// 递归计算目录内容哈希：路径（排序后）+ 每个文件的 SHA-256。
pub fn content_hash(root: &Path) -> io::Result<String> {
    let mut files = collect_files(root)?;
    files.sort();
    let mut hasher = Sha256::new();
    for (rel, path) in files {
        hasher.update(rel.as_bytes());
        hasher.update(b"\0");
        let bytes = fs::read(&path)?;
        hasher.update(Sha256::digest(&bytes));
        hasher.update(b"\0");
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

/// 把已解包并通过静态检查的 skill 目录固化为不可变快照。
pub fn create_snapshot(
    skills_root: &Path,
    source: &SkillSource,
    extracted_root: &Path,
) -> io::Result<Snapshot> {
    let skill_name = extracted_root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".into());
    let content_sha = content_hash(extracted_root)?;
    let id = format!(
        "{}-{}",
        &source.commit_sha[..12.min(source.commit_sha.len())],
        skill_name
    );
    let snap_root = skills_root.join("snapshots").join(&id);
    if snap_root.exists() {
        let existing_sha = content_hash(&snap_root)?;
        if existing_sha != content_sha {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("snapshot {id} already exists with differing hash: expected {content_sha}, found {existing_sha}"),
            ));
        }
        let file_count = collect_files(&snap_root)?.len();
        return Ok(Snapshot {
            id,
            skill_name,
            root_dir: snap_root,
            file_count,
            content_sha,
        });
    }
    fs::create_dir_all(&snap_root)?;
    copy_tree(extracted_root, &snap_root)?;
    let file_count = collect_files(&snap_root)?.len();
    Ok(Snapshot {
        id,
        skill_name,
        root_dir: snap_root,
        file_count,
        content_sha,
    })
}

pub fn record_snapshot(
    conn: &Connection,
    source: &SkillSource,
    snap: &Snapshot,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO skill_snapshot (id, source_repo, commit_sha, skill_path, skill_name, root_dir, file_count, content_sha, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            snap.id,
            source.repo,
            source.commit_sha,
            source.skill_path,
            snap.skill_name,
            snap.root_dir.to_string_lossy(),
            snap.file_count as i64,
            snap.content_sha,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

/// 计算两个快照或目录之间的 Diff（增删改及 Unified Diff）。
pub fn snapshot_diff(
    base_root: &Path,
    head_root: &Path,
    base_id: &str,
    head_id: &str,
) -> Result<SnapshotDiff, String> {
    let base_files = collect_files_map(base_root).map_err(|e| e.to_string())?;
    let head_files = collect_files_map(head_root).map_err(|e| e.to_string())?;

    let mut added_files = Vec::new();
    let mut deleted_files = Vec::new();
    let mut modified_files = Vec::new();
    let mut identical_files = Vec::new();
    let mut file_diffs = Vec::new();

    // 检查 base 中存在的文件
    for (rel, base_path) in &base_files {
        if let Some(head_path) = head_files.get(rel) {
            let base_bytes = fs::read(base_path).unwrap_or_default();
            let head_bytes = fs::read(head_path).unwrap_or_default();
            if base_bytes == head_bytes {
                identical_files.push(rel.clone());
            } else {
                modified_files.push(rel.clone());
                let base_str = String::from_utf8_lossy(&base_bytes);
                let head_str = String::from_utf8_lossy(&head_bytes);
                let diff_lines = compute_line_diff(&base_str, &head_str);
                file_diffs.push(FileDiffDetail {
                    path: rel.clone(),
                    status: "modified".into(),
                    diff_lines,
                });
            }
        } else {
            deleted_files.push(rel.clone());
            let base_bytes = fs::read(base_path).unwrap_or_default();
            let base_str = String::from_utf8_lossy(&base_bytes);
            let diff_lines = base_str.lines().map(|l| format!("-{l}")).collect();
            file_diffs.push(FileDiffDetail {
                path: rel.clone(),
                status: "deleted".into(),
                diff_lines,
            });
        }
    }

    // 检查 head 中新增的文件
    for (rel, head_path) in &head_files {
        if !base_files.contains_key(rel) {
            added_files.push(rel.clone());
            let head_bytes = fs::read(head_path).unwrap_or_default();
            let head_str = String::from_utf8_lossy(&head_bytes);
            let diff_lines = head_str.lines().map(|l| format!("+{l}")).collect();
            file_diffs.push(FileDiffDetail {
                path: rel.clone(),
                status: "added".into(),
                diff_lines,
            });
        }
    }

    added_files.sort();
    deleted_files.sort();
    modified_files.sort();
    identical_files.sort();
    file_diffs.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(SnapshotDiff {
        base_snapshot_id: base_id.to_string(),
        head_snapshot_id: head_id.to_string(),
        added_files,
        deleted_files,
        modified_files,
        identical_files,
        file_diffs,
    })
}

fn collect_files_map(root: &Path) -> io::Result<BTreeMap<String, PathBuf>> {
    let mut map = BTreeMap::new();
    if !root.exists() {
        return Ok(map);
    }
    for (rel, path) in collect_files(root)? {
        map.insert(rel, path);
    }
    Ok(map)
}

/// 简易 Unified Line Diff 计算
fn compute_line_diff(old_text: &str, new_text: &str) -> Vec<String> {
    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();
    let mut diff = Vec::new();

    let mut i = 0;
    let mut j = 0;
    while i < old_lines.len() || j < new_lines.len() {
        if i < old_lines.len() && j < new_lines.len() && old_lines[i] == new_lines[j] {
            diff.push(format!(" {}", old_lines[i]));
            i += 1;
            j += 1;
        } else {
            if i < old_lines.len() {
                diff.push(format!("-{}", old_lines[i]));
                i += 1;
            }
            if j < new_lines.len() {
                diff.push(format!("+{}", new_lines[j]));
                j += 1;
            }
        }
        if diff.len() > 1000 {
            diff.push("... [diff truncated]".into());
            break;
        }
    }
    diff
}

/// 读取并解析中文说明文档（Derived Metadata）。

pub(crate) fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if ft.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "symlink encountered during copy: {}",
                    entry.path().display()
                ),
            ));
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
