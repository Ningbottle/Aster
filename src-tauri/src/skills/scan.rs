use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::snapshot::{collect_files, content_hash, create_snapshot};
use super::source::SkillSource;

/// 静态检查允许的文件扩展名（小写，不含点）。
const ALLOWED_EXTENSIONS: &[&str] = &[
    "md", "txt", "json", "yaml", "yml", "png", "jpg", "jpeg", "gif", "svg",
];
const MAX_FILES: usize = 200;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;

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


pub fn scan_multi_skill_repo(
    repo_root: &Path,
    repo_name: &str,
    commit_or_version: &str,
    translations_root: Option<&Path>,
    skills_root: Option<&Path>,
) -> Result<SkillRepoGroup, String> {
    if !repo_root.is_dir() {
        return Err(format!(
            "repo root {} is not a directory",
            repo_root.display()
        ));
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
        // 版本段决定快照 id：GitHub 来源用真实 commit 前缀（有诊断价值）；本地扫描
        // 没有 commit 概念，用内容哈希前 12 位——同一 Skill 内容变化后重扫必须产生
        // 新快照 id，否则历史快照链与 Diff 永远不可能形成（2026-08-18 修复）。
        let version_seg: String = if commit_or_version == "local" {
            let hex = content_sha.strip_prefix("sha256:").unwrap_or(&content_sha);
            hex[..12.min(hex.len())].to_string()
        } else {
            commit_or_version[..12.min(commit_or_version.len())].to_string()
        };
        let snapshot_id = format!("{}-{}", version_seg, name);

        if let Some(sr) = skills_root {
            let src = SkillSource {
                repo: repo_name.to_string(),
                commit_sha: version_seg.clone(),
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

    let source_type = if repo_name.contains('/')
        && !repo_name.contains('\\')
        && !repo_name.contains(':')
        && commit_or_version != "local"
    {
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
            "exe"
                | "bat"
                | "cmd"
                | "ps1"
                | "sh"
                | "js"
                | "mjs"
                | "cjs"
                | "py"
                | "pl"
                | "rb"
                | "dll"
                | "com"
                | "scr"
                | "vbs"
                | "wsf"
                | "msi"
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

