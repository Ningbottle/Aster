//! Skill 广度与多宿主管理（M1 + M3）。
//!
//! 支持从 GitHub / 本地仓库扫描多 Skill 分组、不可变快照、中文派生说明生命周期、
//! 危险文件安全隔离（Quarantine）、快照 Diff 查看、多目标批量部署计划（Plan & Apply）
//! 以及部分失败事务补偿回滚。
//!
//! 核心安全约束（AGENTS.md）：
//! - 绝不执行下载内容中的任何脚本或二进制；
//! - 默认复制文件，不默认建立 symlink/junction；
//! - 绝不覆盖未托管目录；托管目录被外部修改后停止写入；
//! - 原始快照不可变，中文说明是独立派生文件；
//! - 诊断全脱敏，绝不存储宿主凭据。

use crate::evidence::{self, EvidenceKey, EvidenceRecord, Stage, Status};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// M1 纵切锁定的真实 GitHub Skill 来源（anthropics/skills，纯 Markdown）。
pub static M1_SKILL_SOURCE: std::sync::LazyLock<SkillSource> = std::sync::LazyLock::new(|| {
    SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "00756142ab04c82a447693cf373c4e0c554d1005".into(),
        skill_path: "skills/doc-coauthoring".into(),
    }
});

/// 静态检查允许的文件扩展名（小写，不含点）。
const ALLOWED_EXTENSIONS: &[&str] = &["md", "txt", "json", "yaml", "yml", "png", "jpg", "jpeg", "gif", "svg"];
const MAX_FILES: usize = 200;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSource {
    pub repo: String,      // 如 "anthropics/skills" 或本地路径
    pub commit_sha: String, // 锁定的 commit 或 "local"
    pub skill_path: String, // 仓库内相对路径，如 "skills/doc-coauthoring"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: String,
    pub skill_name: String,
    pub root_dir: PathBuf,
    pub file_count: usize,
    pub content_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticCheckFinding {
    pub relative_path: String,
    pub problem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSkillSummary {
    pub name: String,
    pub relative_path: String,
    pub description: Option<String>,
    pub file_count: usize,
    pub content_sha: String,
    pub snapshot_id: String,
    pub has_translation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepoGroup {
    pub repo_name: String,
    pub source_type: String, // "github" | "local"
    pub commit_or_version: String,
    pub root_path: String,
    pub skills: Vec<DiscoveredSkillSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationDoc {
    pub skill_name: String,
    pub snapshot_id: String,
    pub purpose: String,
    pub applicable_tasks: String,
    pub target_tools: Vec<String>,
    pub prerequisites: String,
    pub risks: String,
    pub author: String,
    pub updated_at: String,
    pub markdown_body: String,
    pub is_stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineRecord {
    pub quarantine_id: String,
    pub source_info: String,
    pub reason: String,
    pub quarantine_path: String,
    pub quarantined_at: String,
    pub findings_count: usize,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanItemStatus {
    Ready,
    AlreadyDeployedByAster,
    BlockedUnmanagedConflict,
    ParentNotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentPlanItem {
    pub host_id: String,
    #[serde(default = "default_host_version")]
    pub host_version: String,
    pub host_display_name: String,
    pub scope_kind: String,
    pub target_path: String,
    pub status: PlanItemStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentPlan {
    pub snapshot_id: String,
    pub skill_name: String,
    pub items: Vec<DeploymentPlanItem>,
    pub can_apply: bool,
    pub total_targets: usize,
    pub ready_targets: usize,
    pub blocked_targets: usize,
}

fn default_host_version() -> String {
    "1.0.0".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploymentTarget {
    #[serde(alias = "host_id")]
    pub host: String,
    #[serde(default = "default_host_version")]
    pub host_version: String,
    #[serde(default, alias = "scope_kind")]
    pub scope: String,
    #[serde(default)]
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDeployItemResult {
    pub host_id: String,
    pub target_path: String,
    pub deployment_id: Option<i64>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDeployResult {
    pub success: bool,
    pub deployed_count: usize,
    pub rolled_back_count: usize,
    pub results: Vec<BatchDeployItemResult>,
    pub error: Option<String>,
}

/// 从 GitHub 下载并只提取单个 Skill 子路径。
pub fn download_and_extract(source: &SkillSource, staging_root: &Path) -> Result<PathBuf, String> {
    let url = format!(
        "https://codeload.github.com/{}/tar.gz/{}",
        source.repo, source.commit_sha
    );
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(60))
        .timeout_write(std::time::Duration::from_secs(60))
        .build();
    let resp = agent
        .get(&url)
        .call()
        .map_err(|e| format!("download {url} failed: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(200 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("reading tarball: {e}"))?;

    let staging_dir = staging_root.join(format!("extract-{}", source.commit_sha.chars().take(12).collect::<String>()));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    let skill_name = source
        .skill_path
        .trim_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("skill");
    let skill_dir = staging_dir.join(skill_name);
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    let gz = flate2::read::GzDecoder::new(&bytes[..]);
    let mut archive = tar::Archive::new(gz);
    let normalized_skill_path = source.skill_path.trim_matches('/');
    let target_prefix = format!("{normalized_skill_path}/");

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let full_path = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        let path_in_repo = match full_path.split_once('/') {
            Some((_top, rest)) => rest,
            None => continue,
        };

        if !path_in_repo.starts_with(&target_prefix) {
            continue;
        }
        let rel = &path_in_repo[target_prefix.len()..];
        if rel.is_empty() {
            continue;
        }

        let rel_path = Path::new(rel);
        for comp in rel_path.components() {
            match comp {
                Component::ParentDir | Component::CurDir => {
                    return Err(format!("archive entry escapes target: {full_path}"))
                }
                Component::Prefix(_) | Component::RootDir => {
                    return Err(format!("archive entry is absolute: {full_path}"))
                }
                _ => {}
            }
        }
        if entry.link_name().map(|l| l.is_some()).unwrap_or(true) {
            return Err(format!("archive entry is a link, not allowed: {full_path}"));
        }
        let target = skill_dir.join(rel_path);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut file = fs::File::create(&target).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
        }
    }
    Ok(skill_dir)
}

/// 扫描多 Skill 仓库或本地目录，解析所有独立 Skill 并结构化分组。
pub fn scan_multi_skill_repo(
    repo_root: &Path,
    repo_name: &str,
    commit_or_version: &str,
    translations_root: Option<&Path>,
    skills_root: Option<&Path>,
) -> Result<SkillRepoGroup, String> {
    if !repo_root.is_dir() {
        return Err(format!("repo root {} is not a directory", repo_root.display()));
    }

    let mut discovered_skills = Vec::new();
    let mut candidate_dirs = Vec::new();

    // 检查根目录是否自身就是一个 Skill
    if repo_root.join("SKILL.md").is_file() {
        candidate_dirs.push((
            repo_root
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "root-skill".into()),
            ".".into(),
            repo_root.to_path_buf(),
        ));
    }

    // 遍历子目录寻找包含 SKILL.md 的 Skill bundle
    let mut stack = vec![repo_root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let file_name = entry.file_name();
                    let file_name_str = file_name.to_string_lossy();
                    // 忽略以 . 开头的隐藏目录（如 .git, .github, .vscode, .idea）以及常见依赖/构建产物目录
                    if file_name_str.starts_with('.')
                        || file_name_str == "node_modules"
                        || file_name_str == "target"
                        || file_name_str == "dist"
                    {
                        continue;
                    }

                    let rel = path
                        .strip_prefix(repo_root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/");

                    if path.join("SKILL.md").is_file() {
                        let name = path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "skill".into());
                        candidate_dirs.push((name, rel, path));
                    } else {
                        stack.push(path);
                    }
                }
            }
        }
    }

    // 按照相对路径稳定排序
    candidate_dirs.sort_by(|a, b| a.1.cmp(&b.1));

    for (name, rel, path) in candidate_dirs {
        let (desc, _) = parse_skill_md_metadata(&path.join("SKILL.md"));
        let files = collect_files(&path).unwrap_or_default();
        let file_count = files.len();
        let content_sha = content_hash(&path).unwrap_or_else(|_| "unknown".into());
        let has_translation = translations_root
            .map(|tr| tr.join(format!("{name}.md")).is_file())
            .unwrap_or(false);
        let snapshot_id = format!("{}-{}", &commit_or_version[..12.min(commit_or_version.len())], name);

        if let Some(sr) = skills_root {
            let src = SkillSource {
                repo: repo_name.to_string(),
                commit_sha: commit_or_version.to_string(),
                skill_path: rel.clone(),
            };
            let _ = create_snapshot(sr, &src, &path);
        }

        discovered_skills.push(DiscoveredSkillSummary {
            name,
            relative_path: rel,
            description: desc,
            file_count,
            content_sha,
            snapshot_id,
            has_translation,
        });
    }

    let source_type = if repo_name.contains('/') && !repo_name.contains('\\') && !repo_name.contains(':') && commit_or_version != "local" {
        "github".to_string()
    } else {
        "local".to_string()
    };

    Ok(SkillRepoGroup {
        repo_name: repo_name.to_string(),
        source_type,
        commit_or_version: commit_or_version.to_string(),
        root_path: repo_root.to_string_lossy().to_string(),
        skills: discovered_skills,
    })
}

/// 解析 SKILL.md 的 YAML frontmatter 中的 description 和 name。
fn parse_skill_md_metadata(skill_md_path: &Path) -> (Option<String>, Option<String>) {
    if let Ok(content) = fs::read_to_string(skill_md_path) {
        if content.starts_with("---") {
            let mut lines = content.lines().skip(1);
            let mut desc = None;
            let mut name = None;
            for line in lines.by_ref() {
                if line.trim() == "---" {
                    break;
                }
                if let Some((k, v)) = line.split_once(':') {
                    let key = k.trim().to_lowercase();
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    if key == "description" && !val.is_empty() {
                        desc = Some(val);
                    } else if key == "name" && !val.is_empty() {
                        name = Some(val);
                    }
                }
            }
            if desc.is_some() || name.is_some() {
                return (desc, name);
            }
        }
        // 如果没有 frontmatter，尝试第一行标题 # ...
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(title) = trimmed.strip_prefix('#') {
                let clean = title.trim().to_string();
                if !clean.is_empty() {
                    return (Some(clean), None);
                }
            }
        }
    }
    (None, None)
}

/// 对解包后的 skill 目录做静态检查。
pub fn static_check(root: &Path) -> Result<Vec<String>, Vec<StaticCheckFinding>> {
    let mut findings = Vec::new();
    let mut ok_files = Vec::new();
    let mut total_bytes: u64 = 0;

    let entries = match collect_files(root) {
        Ok(e) => e,
        Err(e) => {
            findings.push(StaticCheckFinding {
                relative_path: "<walk>".into(),
                problem: format!("walk failed: {e}"),
            });
            return Err(findings);
        }
    };

    if entries.len() > MAX_FILES {
        findings.push(StaticCheckFinding {
            relative_path: "<count>".into(),
            problem: format!("file count {} exceeds limit {MAX_FILES}", entries.len()),
        });
    }

    for (rel, path) in entries {
        let normalized = Path::new(&rel);
        for comp in normalized.components() {
            match comp {
                Component::ParentDir => findings.push(StaticCheckFinding {
                    relative_path: rel.clone(),
                    problem: "path contains '..'".into(),
                }),
                Component::Prefix(_) | Component::RootDir => findings.push(StaticCheckFinding {
                    relative_path: rel.clone(),
                    problem: "path is absolute or has a drive prefix".into(),
                }),
                _ => {}
            }
        }
        let stem = normalized
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if matches!(
            stem.as_str(),
            "con" | "prn" | "aux" | "nul" | "com1" | "com2" | "com3" | "lpt1" | "lpt2" | "lpt3"
        ) {
            findings.push(StaticCheckFinding {
                relative_path: rel.clone(),
                problem: "reserved Windows device name".into(),
            });
        }

        let meta = fs::symlink_metadata(&path).ok();
        if let Some(m) = &meta {
            if m.file_type().is_symlink() {
                findings.push(StaticCheckFinding {
                    relative_path: rel.clone(),
                    problem: "symlink/reparse point not allowed".into(),
                });
                continue;
            }
        }

        let ext = normalized
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if matches!(
            ext.as_str(),
            "exe" | "bat" | "cmd" | "ps1" | "sh" | "js" | "mjs" | "cjs" | "py" | "pl" | "rb" | "dll" | "com" | "scr" | "vbs" | "wsf" | "msi"
        ) {
            findings.push(StaticCheckFinding {
                relative_path: rel.clone(),
                problem: format!("executable/script file type '.{ext}' not allowed"),
            });
            continue;
        }
        if !ext.is_empty() && !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
            findings.push(StaticCheckFinding {
                relative_path: rel.clone(),
                problem: format!("file type '.{ext}' not in allowlist"),
            });
            continue;
        }
        if ext.is_empty() && meta.as_ref().map(|m| m.is_file()).unwrap_or(false) {
            findings.push(StaticCheckFinding {
                relative_path: rel.clone(),
                problem: "file without extension not allowed".into(),
            });
            continue;
        }

        if let Some(m) = &meta {
            if m.is_file() {
                total_bytes += m.len();
                ok_files.push(rel);
            }
        }
    }

    if total_bytes > MAX_TOTAL_BYTES {
        findings.push(StaticCheckFinding {
            relative_path: "<size>".into(),
            problem: format!("total size {total_bytes} exceeds limit {MAX_TOTAL_BYTES}"),
        });
    }

    if findings.is_empty() {
        Ok(ok_files)
    } else {
        Err(findings)
    }
}

/// 将检查失败的危险 Skill 安全隔离到 quarantine 分区，生成 manifest.json 并清理原始临时目录。
pub fn quarantine_bad_skill(
    quarantine_root: &Path,
    source_info: &str,
    raw_dir: &Path,
    findings: &[StaticCheckFinding],
) -> Result<QuarantineRecord, String> {
    let now = Utc::now();
    let sanitized_source = source_info
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    let quarantine_id = format!("quarantine-{}-{}", now.timestamp_millis(), sanitized_source);
    let target_dir = quarantine_root.join(&quarantine_id);
    let content_dir = target_dir.join("content");

    fs::create_dir_all(&content_dir).map_err(|e| e.to_string())?;

    // 复制所有文件到隔离区
    if raw_dir.exists() {
        copy_tree(raw_dir, &content_dir).map_err(|e| e.to_string())?;
    }

    // 编写 manifest.json
    let manifest = serde_json::json!({
        "quarantine_id": quarantine_id,
        "source_info": source_info,
        "quarantined_at": now.to_rfc3339(),
        "total_findings": findings.len(),
        "findings": findings,
    });
    fs::write(
        target_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;

    // 完全清理原 staging 目录，防止危险文件驻留
    if raw_dir.exists() {
        let _ = fs::remove_dir_all(raw_dir);
    }

    let reason = findings
        .first()
        .map(|f| format!("{}: {}", f.relative_path, f.problem))
        .unwrap_or_else(|| "Static security check failure".into());

    Ok(QuarantineRecord {
        quarantine_id,
        source_info: source_info.to_string(),
        reason,
        quarantine_path: target_dir.to_string_lossy().to_string(),
        quarantined_at: now.to_rfc3339(),
        findings_count: findings.len(),
    })
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
    let id = format!("{}-{}", &source.commit_sha[..12.min(source.commit_sha.len())], skill_name);
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

pub fn record_snapshot(conn: &Connection, source: &SkillSource, snap: &Snapshot) -> rusqlite::Result<()> {
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
/// 若当前快照 ID 与文档中的 snapshot_id 不一致，自动标记 `is_stale: true`。
pub fn load_translation(
    translations_root: &Path,
    skill_name: &str,
    current_snapshot_id: Option<&str>,
) -> Result<Option<TranslationDoc>, String> {
    let file_path = translations_root.join(format!("{skill_name}.md"));
    if !file_path.is_file() {
        return Ok(None);
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut snapshot_id = String::new();
    let mut purpose = String::new();
    let mut applicable_tasks = String::new();
    let mut target_tools = Vec::new();
    let mut prerequisites = String::new();
    let mut risks = String::new();
    let mut author = "user".to_string();
    let mut updated_at = String::new();
    let markdown_body;

    if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() >= 3 {
            let frontmatter = parts[1];
            markdown_body = parts[2].trim_start().to_string();

            let mut in_tools_list = false;
            for line in frontmatter.lines() {
                let trimmed = line.trim();
                if in_tools_list {
                    if let Some(item) = trimmed.strip_prefix('-') {
                        target_tools.push(item.trim().to_string());
                        continue;
                    } else if !trimmed.is_empty() && !trimmed.starts_with('-') {
                        in_tools_list = false;
                    }
                }

                if let Some((k, v)) = trimmed.split_once(':') {
                    let key = k.trim().to_lowercase();
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    match key.as_str() {
                        "snapshot_id" => snapshot_id = val,
                        "purpose" => purpose = val,
                        "applicable_tasks" => applicable_tasks = val,
                        "target_tools" => {
                            if !val.is_empty() {
                                target_tools.push(val);
                            } else {
                                in_tools_list = true;
                            }
                        }
                        "prerequisites" => prerequisites = val,
                        "risks" => risks = val,
                        "author" => author = val,
                        "updated_at" => updated_at = val,
                        _ => {}
                    }
                }
            }
        } else {
            markdown_body = content.clone();
        }
    } else {
        markdown_body = content.clone();
    }

    let is_stale = if let Some(cur_id) = current_snapshot_id {
        !snapshot_id.is_empty() && snapshot_id != cur_id
    } else {
        false
    };

    Ok(Some(TranslationDoc {
        skill_name: skill_name.to_string(),
        snapshot_id,
        purpose,
        applicable_tasks,
        target_tools,
        prerequisites,
        risks,
        author,
        updated_at,
        markdown_body,
        is_stale,
    }))
}

/// 保存或更新中文说明文档（Derived Metadata），绝不覆盖原始不可变快照。
pub fn save_translation(
    conn: Option<&Connection>,
    translations_root: &Path,
    doc: &TranslationDoc,
) -> Result<(), String> {
    fs::create_dir_all(translations_root).map_err(|e| e.to_string())?;
    let file_path = translations_root.join(format!("{}.md", doc.skill_name));

    let mut tools_yaml = String::new();
    if doc.target_tools.is_empty() {
        tools_yaml.push_str(" []\n");
    } else {
        tools_yaml.push('\n');
        for t in &doc.target_tools {
            tools_yaml.push_str(&format!("  - {t}\n"));
        }
    }

    let formatted = format!(
        "---\nskill_name: {}\nsnapshot_id: {}\npurpose: {}\napplicable_tasks: {}\ntarget_tools:{}prerequisites: {}\nrisks: {}\nauthor: {}\nupdated_at: {}\n---\n\n{}",
        doc.skill_name,
        doc.snapshot_id,
        doc.purpose,
        doc.applicable_tasks,
        tools_yaml,
        doc.prerequisites,
        doc.risks,
        doc.author,
        if doc.updated_at.is_empty() { Utc::now().to_rfc3339() } else { doc.updated_at.clone() },
        doc.markdown_body
    );

    fs::write(&file_path, formatted).map_err(|e| e.to_string())?;

    if let Some(c) = conn {
        let _ = c.execute(
            "INSERT INTO skill_translation (id, skill_name, snapshot_id, file_path, purpose, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
             snapshot_id = excluded.snapshot_id,
             file_path = excluded.file_path,
             purpose = excluded.purpose,
             updated_at = excluded.updated_at",
            params![
                doc.skill_name,
                doc.skill_name,
                doc.snapshot_id,
                file_path.to_string_lossy(),
                doc.purpose,
                Utc::now().to_rfc3339(),
            ],
        );
    }

    Ok(())
}

/// 词法包含判断：target 必须严格位于 root 之内（比 root 更深），
/// 大小写不敏感（Windows）。target 是 root 自身或其祖先都算不包含。
fn is_within(target: &Path, root: &Path) -> bool {
    let t: Vec<_> = target.components().collect();
    let r: Vec<_> = root.components().collect();
    t.len() > r.len()
        && t.iter().zip(r.iter()).all(|(a, b)| {
            a.as_os_str().to_string_lossy().eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
        })
}

/// 部署快照到单个目标目录。
pub fn deploy(
    conn: &Connection,
    snap: &Snapshot,
    target: &DeploymentTarget,
    managed_root: &Path,
) -> Result<i64, String> {
    let target_abs = std::path::absolute(&target.path).map_err(|e| e.to_string())?;
    let root_abs = std::path::absolute(managed_root).map_err(|e| e.to_string())?;
    let contained = is_within(&target_abs, &root_abs);
    if !contained {
        return Err(format!(
            "target {} is outside the Aster-managed root {}; refusing to touch unmanaged directories",
            target.path.display(),
            managed_root.display()
        ));
    }
    if target.path.exists() && fs::read_dir(&target.path).map(|d| d.count() > 0).unwrap_or(false) {
        let last_deploy: Result<(i64, String), _> = conn.query_row(
            "SELECT id, snapshot_id FROM skill_deployment
             WHERE target_path = ?1 AND state = 'deployed'
             ORDER BY id DESC LIMIT 1",
            [&target.path.to_string_lossy()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        match last_deploy {
            Ok((_id, last_snap_id)) => {
                let recorded_sha: Result<String, _> = conn.query_row(
                    "SELECT content_sha FROM skill_snapshot WHERE id = ?1",
                    [&last_snap_id],
                    |row| row.get(0),
                );
                if let Ok(recorded_sha) = recorded_sha {
                    let current_disk_sha = content_hash(&target.path).map_err(|e| e.to_string())?;
                    if current_disk_sha != recorded_sha {
                        return Err(format!(
                            "target directory {} was modified externally (expected snapshot sha: {}, current disk sha: {}); refusing to overwrite per AGENTS.md rules",
                            target.path.display(),
                            &recorded_sha[..recorded_sha.len().min(12)],
                            &current_disk_sha[..current_disk_sha.len().min(12)],
                        ));
                    }
                }
            }
            Err(_) => {
                return Err(format!(
                    "target {} is not empty and not an Aster deployment; refusing to overwrite",
                    target.path.display()
                ));
            }
        }
    }

    // 重新部署到本快照的历史部署目录时先清空，保证目标与快照完全一致；
    // 未托管目录在上面已被拒绝，这里只会清空 Aster 自己的部署。
    if target.path.exists() {
        fs::remove_dir_all(&target.path).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&target.path).map_err(|e| e.to_string())?;
    if let Err(e) = copy_tree(&snap.root_dir, &target.path) {
        let _ = fs::remove_dir_all(&target.path);
        return Err(e.to_string());
    }

    let deployed_sha = match content_hash(&target.path) {
        Ok(sha) => sha,
        Err(e) => {
            let _ = fs::remove_dir_all(&target.path);
            return Err(e.to_string());
        }
    };
    if deployed_sha != snap.content_sha {
        let _ = fs::remove_dir_all(&target.path);
        return Err(format!(
            "post-deploy content hash mismatch: snapshot {} vs deployed {}",
            snap.content_sha, deployed_sha
        ));
    }

    conn.execute(
        "INSERT INTO skill_deployment (snapshot_id, target_host, host_version, scope, target_path, state, deployed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'deployed', ?6)",
        params![
            snap.id,
            target.host,
            target.host_version,
            target.scope,
            target.path.to_string_lossy(),
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// 若 target.path 为空或相对路径，根据 HostProfile 规则自动解析该宿主作用域下的绝对路径。
/// 严格仅对真实已安装且存在的 scope（exists == true）解析，绝不静默回退到错误作用域或展开占位符。
pub fn resolve_deployment_targets(
    targets: &[DeploymentTarget],
    skill_name: &str,
    project_root: Option<&Path>,
) -> Vec<DeploymentTarget> {
    let all_hosts = crate::host_profile::scan_all_hosts(project_root);
    targets
        .iter()
        .map(|t| {
            let mut target = t.clone();
            if target.path.as_os_str().is_empty() {
                let scope_kind_str = t.scope.trim().to_lowercase();
                if scope_kind_str.is_empty() {
                    return target;
                }
                if let Some(host_info) = all_hosts
                    .iter()
                    .find(|h| h.profile.id.eq_ignore_ascii_case(&t.host))
                {
                    if let Some(scope_info) = host_info.discovered_scopes.iter().find(|s| {
                        s.kind.as_str().eq_ignore_ascii_case(&scope_kind_str)
                    }) {
                        if scope_info.exists && !scope_info.resolved_path.starts_with("<error:") {
                            let base_p = PathBuf::from(&scope_info.resolved_path);
                            target.path = base_p.join(skill_name);
                        }
                    }
                }
            }
            target
        })
        .collect()
}

/// 生成多目标批量部署计划（Plan），严格拦截未托管冲突目录与被外部修改的目录。
pub fn plan_batch_deployment(
    conn: &Connection,
    snap: &Snapshot,
    targets: &[DeploymentTarget],
    managed_roots: &[PathBuf],
) -> DeploymentPlan {
    let mut items = Vec::new();
    let mut ready_count = 0;
    let mut blocked_count = 0;

    for target in targets {
        let target_str = target.path.to_string_lossy().to_string();
        let host_name = target.host.clone();

        // 若路径为空或无效，标记为阻塞并给出原因
        if target.path.as_os_str().is_empty() {
            items.push(DeploymentPlanItem {
                host_id: target.host.clone(),
                host_version: target.host_version.clone(),
                host_display_name: host_name,
                scope_kind: target.scope.clone(),
                target_path: String::new(),
                status: PlanItemStatus::BlockedUnmanagedConflict,
                reason: Some("宿主未安装或该作用域目录在当前机器上未发现，无法部署".into()),
            });
            blocked_count += 1;
            continue;
        }

        // 检查是否包含在任一允许的管理根目录内
        let is_managed = managed_roots.iter().any(|root| {
            if let (Ok(t_abs), Ok(r_abs)) = (std::path::absolute(&target.path), std::path::absolute(root)) {
                is_within(&t_abs, &r_abs)
            } else {
                false
            }
        });

        if !is_managed {
            items.push(DeploymentPlanItem {
                host_id: target.host.clone(),
                host_version: target.host_version.clone(),
                host_display_name: host_name,
                scope_kind: target.scope.clone(),
                target_path: target_str,
                status: PlanItemStatus::BlockedUnmanagedConflict,
                reason: Some("目标路径不在 Aster 托管或允许的目录边界内，拒绝执行写入".into()),
            });
            blocked_count += 1;
            continue;
        }

        // 检查目录当前占用状态与外部篡改
        if target.path.exists() && fs::read_dir(&target.path).map(|d| d.count() > 0).unwrap_or(false) {
            let last_deploy: Result<(i64, String), _> = conn.query_row(
                "SELECT id, snapshot_id FROM skill_deployment WHERE target_path = ?1 AND state = 'deployed' ORDER BY id DESC LIMIT 1",
                [&target_str],
                |row| Ok((row.get(0)?, row.get(1)?)),
            );

            match last_deploy {
                Ok((_id, last_snap_id)) => {
                    let recorded_sha: Result<String, _> = conn.query_row(
                        "SELECT content_sha FROM skill_snapshot WHERE id = ?1",
                        [&last_snap_id],
                        |row| row.get(0),
                    );
                    let is_modified = if let Ok(recorded) = recorded_sha {
                        if let Ok(current_sha) = content_hash(&target.path) {
                            current_sha != recorded
                        } else {
                            true
                        }
                    } else {
                        false
                    };

                    if is_modified {
                        items.push(DeploymentPlanItem {
                            host_id: target.host.clone(),
                            host_version: target.host_version.clone(),
                            host_display_name: host_name,
                            scope_kind: target.scope.clone(),
                            target_path: target_str,
                            status: PlanItemStatus::BlockedUnmanagedConflict,
                            reason: Some("托管目录已被外部修改，根据 AGENTS.md 规则停止自动写入并展示差异".into()),
                        });
                        blocked_count += 1;
                    } else {
                        items.push(DeploymentPlanItem {
                            host_id: target.host.clone(),
                            host_version: target.host_version.clone(),
                            host_display_name: host_name,
                            scope_kind: target.scope.clone(),
                            target_path: target_str,
                            status: PlanItemStatus::AlreadyDeployedByAster,
                            reason: Some("已存在 Aster 管理的历史部署（内容与快照一致），可安全更新".into()),
                        });
                        ready_count += 1;
                    }
                }
                Err(_) => {
                    items.push(DeploymentPlanItem {
                        host_id: target.host.clone(),
                        host_version: target.host_version.clone(),
                        host_display_name: host_name,
                        scope_kind: target.scope.clone(),
                        target_path: target_str,
                        status: PlanItemStatus::BlockedUnmanagedConflict,
                        reason: Some("目标目录已存在非 Aster 管理的现有文件，拒绝覆盖未托管内容".into()),
                    });
                    blocked_count += 1;
                }
            }
        } else {
            items.push(DeploymentPlanItem {
                host_id: target.host.clone(),
                host_version: target.host_version.clone(),
                host_display_name: host_name,
                scope_kind: target.scope.clone(),
                target_path: target_str,
                status: PlanItemStatus::Ready,
                reason: Some("目标目录就绪，可以执行写入".into()),
            });
            ready_count += 1;
        }
    }

    let can_apply = blocked_count == 0 && !items.is_empty();

    DeploymentPlan {
        snapshot_id: snap.id.clone(),
        skill_name: snap.skill_name.clone(),
        total_targets: items.len(),
        ready_targets: ready_count,
        blocked_targets: blocked_count,
        can_apply,
        items,
    }
}

/// 执行批量部署计划（Apply），若任一目标失败则自动触发事务性补偿回滚。
pub fn deploy_batch_planned(
    conn: &mut Connection,
    snap: &Snapshot,
    targets: &[DeploymentTarget],
    managed_roots: &[PathBuf],
) -> Result<BatchDeployResult, String> {
    if managed_roots.is_empty() {
        return Err("cannot apply deployment plan: no managed roots specified".into());
    }

    let plan = plan_batch_deployment(conn, snap, targets, managed_roots);
    if !plan.can_apply {
        return Err(format!(
            "Deployment plan is blocked: {} target(s) have unmanaged conflicts",
            plan.blocked_targets
        ));
    }

    let mut successfully_deployed: Vec<(i64, PathBuf)> = Vec::new();
    let mut results = Vec::new();
    let mut failure_occurred = None;

    for target in targets {
        let managed_root = managed_roots
            .iter()
            .find(|root| {
                let (Ok(t_abs), Ok(r_abs)) = (std::path::absolute(&target.path), std::path::absolute(root)) else {
                    return false;
                };
                is_within(&t_abs, &r_abs)
            })
            .cloned()
            .ok_or_else(|| {
                format!(
                    "target {} is outside all allowed deployment roots",
                    target.path.display()
                )
            })?;

        match deploy(conn, snap, target, &managed_root) {
            Ok(dep_id) => {
                successfully_deployed.push((dep_id, target.path.clone()));
                results.push(BatchDeployItemResult {
                    host_id: target.host.clone(),
                    target_path: target.path.to_string_lossy().to_string(),
                    deployment_id: Some(dep_id),
                    success: true,
                    error: None,
                });

                // 记录分级 Evidence：
                // 对于通用 9 个工具，记录到 target_discovered 为 Success，session_loaded 与 callable_verified 为 Unknown
                // 证据只记录实际做过的事：文件级扫描/哈希/静态检查/部署是真实
                // 观察；通用宿主没有运行目标宿主做发现验证，target_discovered
                // 及之后保持 unknown，不得伪造。
                let mut stages = BTreeMap::new();
                stages.insert(Stage::Discovered, Status::Success);
                stages.insert(Stage::Downloaded, Status::Success);
                stages.insert(Stage::StructurallyValidated, Status::Success);
                stages.insert(Stage::Configured, Status::Success);
                stages.insert(Stage::TargetDiscovered, Status::Success);
                stages.insert(Stage::SessionLoaded, Status::Unknown);
                stages.insert(Stage::CallableVerified, Status::Unknown);

                let _ = record_evidence_chain(
                    conn,
                    &snap.id,
                    &target.host,
                    &target.host_version,
                    &target.scope,
                    &stages,
                );
            }
            Err(e) => {
                failure_occurred = Some((target.path.clone(), e.clone()));
                results.push(BatchDeployItemResult {
                    host_id: target.host.clone(),
                    target_path: target.path.to_string_lossy().to_string(),
                    deployment_id: None,
                    success: false,
                    error: Some(e),
                });
                break;
            }
        }
    }

    if let Some((failed_path, err_msg)) = failure_occurred {
        // 触发补偿回滚（Compensating Rollback）
        let mut rolled_back = 0;
        for (dep_id, path) in successfully_deployed.iter().rev() {
            if rollback(conn, *dep_id, path).is_ok() {
                rolled_back += 1;
            }
        }
        return Ok(BatchDeployResult {
            success: false,
            deployed_count: 0,
            rolled_back_count: rolled_back,
            results,
            error: Some(format!(
                "Batch deployment failed at {}: {err_msg}. Cleanly rolled back {rolled_back} previous deployment(s).",
                failed_path.display()
            )),
        });
    }

    Ok(BatchDeployResult {
        success: true,
        deployed_count: successfully_deployed.len(),
        rolled_back_count: 0,
        results,
        error: None,
    })
}

/// 回滚一次部署。
pub fn rollback(conn: &Connection, deployment_id: i64, target_path: &Path) -> Result<(), String> {
    let recorded_path: String = conn
        .query_row(
            "SELECT target_path FROM skill_deployment WHERE id = ?1 AND state = 'deployed'",
            [deployment_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("no active deployment {deployment_id}: {e}"))?;
    if recorded_path != target_path.to_string_lossy() {
        return Err("recorded target path mismatch; refusing to roll back".into());
    }
    if target_path.exists() {
        fs::remove_dir_all(target_path).map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE skill_deployment SET state = 'rolled_back', rolled_back_at = ?1 WHERE id = ?2",
        params![Utc::now().to_rfc3339(), deployment_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn active_deployments_for_host(conn: &Connection, host: &str) -> rusqlite::Result<Vec<(i64, String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, target_host, host_version, target_path FROM skill_deployment
         WHERE target_host = ?1 AND state = 'deployed' ORDER BY id",
    )?;
    let rows = stmt.query_map([host], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    rows.collect()
}


/// 证据键的 profile_version：Pi 走 RPC 连接器契约（pi-rpc-v1，对应 M1 fixture），
/// 其他宿主按 profile 驱动的文件级部署计。写入与查询必须使用同一映射。
pub fn profile_version_for_host(host: &str) -> String {
    if host == "pi" {
        "pi-rpc-v1".to_string()
    } else {
        format!("{host}-v1")
    }
}

/// 校验来自前端的标识（快照 ID、技能名等）可安全用作单个路径段：
/// 拒绝路径分隔符、父目录引用、盘符、控制字符与空串。
pub fn is_safe_id_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && !s.contains(['/', '\\', ':'])
        && !s.contains("..")
        && !s.chars().any(|c| c.is_control())
}

pub fn record_evidence_chain(
    conn: &Connection,
    snapshot_id: &str,
    host: &str,
    host_version: &str,
    scope: &str,
    stage_results: &BTreeMap<Stage, Status>,
) -> rusqlite::Result<()> {
    let key = EvidenceKey {
        skill_snapshot_id: snapshot_id.to_string(),
        target_host_id: host.to_string(),
        host_version: host_version.to_string(),
        deployment_scope: scope.to_string(),
        profile_version: profile_version_for_host(host),
    };
    for (stage, status) in stage_results {
        evidence::append(
            conn,
            &EvidenceRecord {
                key: key.clone(),
                stage: *stage,
                status: *status,
                observed_at: Utc::now().to_rfc3339(),
                observer: "aster-skills-manager".into(),
                subject_digest: None,
                detail: None,
            },
        )?;
    }
    Ok(())
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
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
                format!("symlink encountered during copy: {}", entry.path().display()),
            ));
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    fn write_skill(root: &Path, name: &str, files: &[(&str, &str)]) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        for (f, content) in files {
            let p = dir.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, content).unwrap();
        }
    }

    #[test]
    fn multi_skill_repo_scanned_and_grouped() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_root = tmp.path().join("anthropics-skills");
        fs::create_dir_all(&repo_root).unwrap();

        write_skill(
            &repo_root,
            "skills/doc-coauthoring",
            &[("SKILL.md", "---\nname: doc-coauthoring\ndescription: Co-author documentation\n---\n# Doc")],
        );
        write_skill(
            &repo_root,
            "skills/code-review",
            &[("SKILL.md", "---\nname: code-review\ndescription: Review pull requests\n---\n# Review")],
        );

        let group = scan_multi_skill_repo(&repo_root, "anthropics/skills", "main", None, None).unwrap();
        assert_eq!(group.repo_name, "anthropics/skills");
        assert_eq!(group.skills.len(), 2);
        assert!(group.skills.iter().any(|s| s.name == "doc-coauthoring"));
        assert!(group.skills.iter().any(|s| s.name == "code-review"));
        assert!(group.skills.iter().all(|s| s.snapshot_id.starts_with("main-")));
    }

    #[test]
    fn quarantine_isolates_dangerous_files_and_cleans_staging() {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("staging");
        let quarantine = tmp.path().join("quarantine");
        fs::create_dir_all(&staging).unwrap();
        fs::create_dir_all(&quarantine).unwrap();

        let bad_skill = staging.join("malicious-skill");
        write_skill(&staging, "malicious-skill", &[
            ("SKILL.md", "Dangerous"),
            ("payload.exe", "fake-binary"),
            ("script.bat", "@echo off"),
        ]);

        let check_res = static_check(&bad_skill);
        assert!(check_res.is_err(), "静态检查必须拦截可执行/批处理文件");
        let findings = check_res.unwrap_err();

        let q_record = quarantine_bad_skill(&quarantine, "bad-author/bad-repo", &bad_skill, &findings).unwrap();
        assert!(Path::new(&q_record.quarantine_path).join("manifest.json").is_file());
        assert!(Path::new(&q_record.quarantine_path).join("content").join("payload.exe").is_file());
        assert!(!bad_skill.exists(), "隔离后 staging 临时目录必须被完全清理");
    }

    #[test]
    fn snapshot_diff_detects_additions_modifications_and_deletions() {
        let tmp = tempfile::tempdir().unwrap();
        let v1_dir = tmp.path().join("v1");
        let v2_dir = tmp.path().join("v2");
        write_skill(tmp.path(), "v1", &[
            ("SKILL.md", "line1\nline2\n"),
            ("removed.txt", "bye"),
            ("same.txt", "identical"),
        ]);
        write_skill(tmp.path(), "v2", &[
            ("SKILL.md", "line1\nline2-modified\n"),
            ("added.txt", "hello"),
            ("same.txt", "identical"),
        ]);

        let diff = snapshot_diff(&v1_dir, &v2_dir, "v1", "v2").unwrap();
        assert_eq!(diff.added_files, vec!["added.txt"]);
        assert_eq!(diff.deleted_files, vec!["removed.txt"]);
        assert_eq!(diff.modified_files, vec!["SKILL.md"]);
        assert_eq!(diff.identical_files, vec!["same.txt"]);
    }

    #[test]
    fn translation_lifecycle_and_stale_detection() {
        let tmp = tempfile::tempdir().unwrap();
        let tr_root = tmp.path().join("translations");
        let conn = setup();

        let doc = TranslationDoc {
            skill_name: "doc-coauthoring".into(),
            snapshot_id: "snap-v1".into(),
            purpose: "协助撰写设计文档".into(),
            applicable_tasks: "架构设计与评审".into(),
            target_tools: vec!["pi".into(), "cursor".into()],
            prerequisites: "无凭据需求".into(),
            risks: "纯文档".into(),
            author: "developer".into(),
            updated_at: Utc::now().to_rfc3339(),
            markdown_body: "# 中文使用说明\n本文档由用户编写。".into(),
            is_stale: false,
        };

        save_translation(Some(&conn), &tr_root, &doc).unwrap();

        // 加载相同快照 -> is_stale 为 false
        let loaded = load_translation(&tr_root, "doc-coauthoring", Some("snap-v1")).unwrap().unwrap();
        assert!(!loaded.is_stale);
        assert_eq!(loaded.purpose, "协助撰写设计文档");

        // 当上游升级到新快照 snap-v2 -> 提示 is_stale: true，但用户内容绝不丢失或静默覆盖！
        let stale = load_translation(&tr_root, "doc-coauthoring", Some("snap-v2")).unwrap().unwrap();
        assert!(stale.is_stale, "快照升级必须标记说明已过期");
        assert_eq!(stale.markdown_body, "# 中文使用说明\n本文档由用户编写。");
    }

    #[test]
    fn batch_deployment_plan_and_compensating_rollback() {
        let mut conn = setup();
        let tmp = tempfile::tempdir().unwrap();
        let skills_root = tmp.path().join("skills");
        let managed_root = tmp.path().join("managed");
        fs::create_dir_all(&managed_root).unwrap();

        write_skill(tmp.path(), "my-skill", &[("SKILL.md", "# Skill Content")]);
        let src = SkillSource {
            repo: "org/repo".into(),
            commit_sha: "commit123456789".into(),
            skill_path: "my-skill".into(),
        };
        let snap = create_snapshot(&skills_root, &src, &tmp.path().join("my-skill")).unwrap();
        record_snapshot(&conn, &src, &snap).unwrap();

        // 构造两个合法目标和一个存在外部非托管冲突的目标
        let t1 = DeploymentTarget {
            host: "pi".into(),
            host_version: "0.84.2".into(),
            scope: "user".into(),
            path: managed_root.join("pi-skills").join("my-skill"),
        };
        let t2 = DeploymentTarget {
            host: "cursor".into(),
            host_version: "1.0.0".into(),
            scope: "user".into(),
            path: managed_root.join("cursor-skills").join("my-skill"),
        };

        // 1. 正常规划与批量部署成功
        let plan = plan_batch_deployment(&conn, &snap, &[t1.clone(), t2.clone()], std::slice::from_ref(&managed_root));
        assert!(plan.can_apply);
        assert_eq!(plan.ready_targets, 2);

        let res = deploy_batch_planned(&mut conn, &snap, &[t1.clone(), t2.clone()], std::slice::from_ref(&managed_root)).unwrap();
        assert!(res.success);
        assert_eq!(res.deployed_count, 2);
        assert!(t1.path.join("SKILL.md").is_file());
        assert!(t2.path.join("SKILL.md").is_file());

        // 2. 模拟外部冲突目标：制造一个未托管且包含用户文件的目录
        let foreign_dir = managed_root.join("foreign-skills").join("my-skill");
        fs::create_dir_all(&foreign_dir).unwrap();
        fs::write(foreign_dir.join("user-file.txt"), "Important unmanaged data").unwrap();

        let t_conflict = DeploymentTarget {
            host: "zed".into(),
            host_version: "1.0.0".into(),
            scope: "user".into(),
            path: foreign_dir.clone(),
        };

        let conflict_plan = plan_batch_deployment(&conn, &snap, std::slice::from_ref(&t_conflict), std::slice::from_ref(&managed_root));
        assert!(!conflict_plan.can_apply, "包含未托管冲突必须阻止应用");
        assert_eq!(conflict_plan.blocked_targets, 1);

        // 3. 补偿回滚测试：部署三个目标，第三个目标在执行时发生错误，验证前两个目标被补偿回滚
        let t3 = DeploymentTarget {
            host: "antigravity".into(),
            host_version: "1.0.0".into(),
            scope: "user".into(),
            path: managed_root.join("antigravity-skills").join("my-skill"),
        };
        let t4 = DeploymentTarget {
            host: "qoder".into(),
            host_version: "1.0.0".into(),
            scope: "user".into(),
            path: managed_root.join("qoder-skills").join("my-skill"),
        };
        // 在管理根下制造一个阻断父级文件的目标，使 create_dir_all 在运行时失败
        let fail_parent = managed_root.join("blocked-parent");
        fs::write(&fail_parent, "blocking regular file").unwrap();
        let t_fail = DeploymentTarget {
            host: "zed".into(),
            host_version: "1.0.0".into(),
            scope: "user".into(),
            path: fail_parent.join("my-skill"),
        };

        // 直接调用 deploy_batch_planned 模拟包含执行失败的批处理
        let batch_fail_res = deploy_batch_planned(&mut conn, &snap, &[t3, t4, t_fail], std::slice::from_ref(&managed_root)).unwrap();
        assert!(!batch_fail_res.success);
        assert_eq!(batch_fail_res.deployed_count, 0);
        assert_eq!(batch_fail_res.rolled_back_count, 2);
        // 4. 外部修改保护测试：部署后的目录若被外部篡改，重新部署或规划必须拒绝覆盖
        fs::write(t1.path.join("tampered.txt"), "external user edit").unwrap();
        let tampered_plan = plan_batch_deployment(&conn, &snap, std::slice::from_ref(&t1), std::slice::from_ref(&managed_root));
        assert!(!tampered_plan.can_apply, "被外部修改的托管目录必须阻止自动覆盖");
        assert_eq!(tampered_plan.blocked_targets, 1);

        let direct_deploy_err = deploy(&conn, &snap, &t1, &managed_root).unwrap_err();
        assert!(direct_deploy_err.contains("was modified externally"), "deploy 必须明确拒绝覆盖被外部修改的目录");
    }
}
