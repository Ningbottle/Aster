use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSource {
    pub repo: String,
    pub commit_sha: String,
    pub skill_path: String,
}

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

    let staging_dir = staging_root.join(format!(
        "extract-{}",
        source.commit_sha.chars().take(12).collect::<String>()
    ));
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

/// 把用户给定的 Git ref（分支名、tag、短 sha）解析为真实 commit sha。
///
/// 快照 id 与记录必须使用真实 commit sha：分支名或 "HEAD" 是可移动指针，
/// 直接用作版本段会让同一仓库的重扫永远得到相同快照 id，历史链与 Diff
/// 结构性不可能形成（2026-08-18 GitHub 路径修复，与本地扫描的 "local"
/// 版本段缺陷同类）。已是 40 位十六进制 sha 时直接返回，不做网络请求。
pub fn resolve_github_ref(
    repo: &str,
    git_ref: Option<&str>,
    token: Option<&str>,
) -> Result<String, String> {
    let clean_repo = repo.trim().trim_matches('/');
    if clean_repo.is_empty() || !clean_repo.contains('/') {
        return Err(format!(
            "invalid GitHub repository identifier: '{repo}', expected 'owner/repo'"
        ));
    }
    let target_ref = git_ref.unwrap_or("HEAD").trim();
    let target_ref = if target_ref.is_empty() {
        "HEAD"
    } else {
        target_ref
    };
    if target_ref.len() == 40 && target_ref.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(target_ref.to_ascii_lowercase());
    }

    let api_url = format!("https://api.github.com/repos/{clean_repo}/commits/{target_ref}");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(30))
        .build();
    let mut req = agent
        .get(&api_url)
        .set("User-Agent", "Aster-Desktop")
        .set("Accept", "application/vnd.github.v3+json");
    if let Some(tok) = token.filter(|t| !t.trim().is_empty()) {
        req = req.set("Authorization", &format!("Bearer {tok}"));
    }
    let resp = req.call().map_err(|e| match e {
        ureq::Error::Status(404, _) => {
            format!("GitHub 仓库或引用未找到 (404): {clean_repo}@{target_ref}")
        }
        ureq::Error::Status(401, _) => "GitHub 令牌无效或未授权 (401)，请重新连接".into(),
        ureq::Error::Status(403, _) => "GitHub API 访问被拒绝或触达频率限制 (403)".into(),
        other => format!("GitHub 解析引用失败 {clean_repo}@{target_ref}: {other}"),
    })?;
    let text = resp
        .into_string()
        .map_err(|e| format!("read ref response: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse ref response: {e}"))?;
    let sha = json
        .get("sha")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or_else(|| {
            format!("GitHub ref response missing commit sha for {clean_repo}@{target_ref}")
        })?;
    Ok(sha.to_ascii_lowercase())
}

/// 从 GitHub 安全下载完整仓库并解压到 staging 隔离区。
pub fn download_and_extract_github_repo(
    repo: &str,
    git_ref: Option<&str>,
    token: Option<&str>,
    staging_root: &Path,
) -> Result<PathBuf, String> {
    let clean_repo = repo.trim().trim_matches('/');
    if clean_repo.is_empty() || !clean_repo.contains('/') {
        return Err(format!(
            "invalid GitHub repository identifier: '{repo}', expected 'owner/repo'"
        ));
    }
    let target_ref = git_ref.unwrap_or("HEAD").trim();
    let target_ref = if target_ref.is_empty() {
        "HEAD"
    } else {
        target_ref
    };
    let sanitized_repo = clean_repo.replace('/', "-");
    let sanitized_ref = target_ref.replace(['/', '\\', ':', ' '], "-");

    let staging_dir = staging_root.join(format!("gh-{}-{}", sanitized_repo, sanitized_ref));
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    fs::create_dir_all(&staging_dir).map_err(|e| format!("create staging dir: {e}"))?;

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(90))
        .timeout_write(std::time::Duration::from_secs(90))
        .build();

    let resp = if let Some(tok) = token.filter(|t| !t.trim().is_empty()) {
        let api_url = format!("https://api.github.com/repos/{clean_repo}/tarball/{target_ref}");
        agent
            .get(&api_url)
            .set("Authorization", &format!("Bearer {tok}"))
            .set("User-Agent", "Aster-Desktop")
            .set("Accept", "application/vnd.github.v3+json")
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(404, _) => {
                    format!("GitHub 仓库或分支未找到 (404): {clean_repo}@{target_ref}")
                }
                ureq::Error::Status(401, _) => "GitHub 令牌无效或未授权 (401)，请重新连接".into(),
                ureq::Error::Status(403, _) => "GitHub API 访问被拒绝或触达频率限制 (403)".into(),
                other => format!("GitHub 下载失败: {other}"),
            })?
    } else {
        let codeload_url = format!("https://codeload.github.com/{clean_repo}/tar.gz/{target_ref}");
        agent
            .get(&codeload_url)
            .set("User-Agent", "Aster-Desktop")
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(404, _) => {
                    format!("GitHub 仓库或分支未找到 (404): {clean_repo}@{target_ref}")
                }
                ureq::Error::Status(429, _) => {
                    "GitHub 请求受限 (429)，请稍后重试或配置 GitHub 令牌".into()
                }
                other => format!("GitHub 下载失败: {other}"),
            })?
    };

    let mut bytes = Vec::new();
    resp.into_reader()
        .take(200 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("reading tarball: {e}"))?;

    let gz = flate2::read::GzDecoder::new(&bytes[..]);
    let mut archive = tar::Archive::new(gz);

    for entry in archive
        .entries()
        .map_err(|e| format!("reading archive entries: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("entry error: {e}"))?;
        let full_path = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        let path_in_repo = match full_path.split_once('/') {
            Some((_top, rest)) => rest,
            None => continue,
        };
        if path_in_repo.is_empty() {
            continue;
        }

        let rel_path = Path::new(path_in_repo);
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

        let target = staging_dir.join(rel_path);
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

    Ok(staging_dir)
}

