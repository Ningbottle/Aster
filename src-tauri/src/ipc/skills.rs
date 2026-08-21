#![allow(clippy::unused_async)]

use crate::skills as skill_flow;
use serde::Serialize;
use std::path::PathBuf;

#[tauri::command]
pub async fn skill_status() -> Result<serde_json::Value, String> {
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    let mut snapshots = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at FROM skill_snapshot ORDER BY created_at DESC, id DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "source_repo": row.get::<_, String>(1)?,
                    "commit_sha": row.get::<_, String>(2)?,
                    "skill_name": row.get::<_, String>(3)?,
                    "file_count": row.get::<_, i64>(4)?,
                    "content_sha": row.get::<_, String>(5)?,
                    "created_at": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            snapshots.push(r);
        }
    }
    let mut deployments = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, snapshot_id, target_host, host_version, scope, target_path, state FROM skill_deployment ORDER BY id DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "snapshot_id": row.get::<_, String>(1)?,
                    "target_host": row.get::<_, String>(2)?,
                    "host_version": row.get::<_, String>(3)?,
                    "scope": row.get::<_, String>(4)?,
                    "target_path": row.get::<_, String>(5)?,
                    "state": row.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            deployments.push(r);
        }
    }
    let mut evidence_view = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT skill_snapshot_id, target_host_id, host_version, deployment_scope, stage, status, observer, observed_at FROM evidence ORDER BY id DESC LIMIT 50")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let snap_id: String = row.get(0)?;
                let host_id: String = row.get(1)?;
                let host_ver: String = row.get(2)?;
                let short_snap = if snap_id.len() > 12 {
                    format!("{}…{}", &snap_id[..4], &snap_id[snap_id.len() - 4..])
                } else {
                    snap_id
                };
                Ok(serde_json::json!({
                    "key": format!("{} × {}@{}", short_snap, host_id, host_ver),
                    "stage": row.get::<_, String>(4)?,
                    "status": row.get::<_, String>(5)?,
                    "observer": row.get::<_, String>(6)?,
                    "observed_at": row.get::<_, String>(7)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            evidence_view.push(r);
        }
    }
    Ok(serde_json::json!({
        "snapshots": snapshots,
        "deployments": deployments,
        "evidence": evidence_view,
        "scope_dir": layout.runtimes.join("pi").join("test-scope").display().to_string(),
    }))
}
#[tauri::command]
pub async fn skills_scan_repo(
    repo_path: Option<String>,
    repo_name: Option<String>,
) -> Result<skill_flow::SkillRepoGroup, String> {
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    let path = match repo_path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => {
            let default_p = layout.staging.join("repo");
            if default_p.is_dir() {
                default_p
            } else {
                return Err("未指定本地目录路径，且暂存区无可用仓库。请在输入框中提供本地仓库或技能目录的绝对路径。".into());
            }
        }
    };
    if !path.exists() {
        return Err(format!("指定路径不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("指定路径不是有效文件夹: {}", path.display()));
    }
    let name = repo_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "local-repo".into())
        });
    let group = skill_flow::scan_multi_skill_repo(
        &path,
        &name,
        "local",
        Some(&layout.translations),
        Some(&layout.skills),
    )?;

    // 登记扫描快照元数据到 SQLite
    for sk in &group.skills {
        let snap_dir = layout.skills.join("snapshots").join(&sk.snapshot_id);
        if snap_dir.exists() {
            let snap = skill_flow::Snapshot {
                id: sk.snapshot_id.clone(),
                skill_name: sk.name.clone(),
                root_dir: snap_dir,
                file_count: sk.file_count,
                content_sha: sk.content_sha.clone(),
            };
            let src = skill_flow::SkillSource {
                repo: group.repo_name.clone(),
                commit_sha: group.commit_or_version.clone(),
                skill_path: sk.relative_path.clone(),
            };
            let _ = skill_flow::record_snapshot(&conn, &src, &snap);
        }
    }

    Ok(group)
}

#[tauri::command]
pub async fn skill_get_diff(
    base_snapshot_id: String,
    head_snapshot_id: String,
) -> Result<skill_flow::SnapshotDiff, String> {
    if !skill_flow::is_safe_id_segment(&base_snapshot_id) {
        return Err(format!("invalid base_snapshot_id: {base_snapshot_id}"));
    }
    if !skill_flow::is_safe_id_segment(&head_snapshot_id) {
        return Err(format!("invalid head_snapshot_id: {head_snapshot_id}"));
    }
    let (layout, _conn) = crate::platform::open_layout_and_db()?;
    let base_dir = layout.skills.join("snapshots").join(&base_snapshot_id);
    let head_dir = layout.skills.join("snapshots").join(&head_snapshot_id);
    skill_flow::snapshot_diff(&base_dir, &head_dir, &base_snapshot_id, &head_snapshot_id)
}

#[tauri::command]
pub async fn skill_get_translation(
    skill_name: String,
    current_snapshot_id: Option<String>,
) -> Result<Option<skill_flow::TranslationDoc>, String> {
    if !skill_flow::is_safe_id_segment(&skill_name) {
        return Err(format!("invalid skill_name: {skill_name}"));
    }
    if let Some(ref snap_id) = current_snapshot_id {
        if !skill_flow::is_safe_id_segment(snap_id) {
            return Err(format!("invalid current_snapshot_id: {snap_id}"));
        }
    }
    let (layout, _conn) = crate::platform::open_layout_and_db()?;
    skill_flow::load_translation(
        &layout.translations,
        &skill_name,
        current_snapshot_id.as_deref(),
    )
}

#[tauri::command]
pub async fn skill_save_translation(doc: skill_flow::TranslationDoc) -> Result<(), String> {
    if !skill_flow::is_safe_id_segment(&doc.skill_name) {
        return Err(format!("invalid doc.skill_name: {}", doc.skill_name));
    }
    if !skill_flow::is_safe_id_segment(&doc.snapshot_id) {
        return Err(format!("invalid doc.snapshot_id: {}", doc.snapshot_id));
    }
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    skill_flow::save_translation(Some(&conn), &layout.translations, &doc)
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct SkillItemDto {
    pub id: String, // 快照唯一 ID（作为前端主键）
    pub skill_name: String,
    pub desc: String,
    pub tools: Vec<String>,
    pub updated: String,
    pub original: String,
    pub zh: String,
    pub snapshot_id: String,
    pub previous_snapshot_id: Option<String>,
    pub file_count: usize,
    pub content_sha: String,
}

#[tauri::command]
pub async fn skills_list() -> Result<Vec<SkillItemDto>, String> {
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    let mut stmt = conn
        .prepare("SELECT id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at FROM skill_snapshot ORDER BY skill_name ASC, created_at DESC, id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)? as usize,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let raw_list: Vec<_> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 计算同名 skill 的历史前驱快照（按 created_at DESC 排序后，紧邻的下一个快照即为其前驱版本）
    let mut items_with_prev = Vec::new();
    let total = raw_list.len();
    for i in 0..total {
        let (snap_id, source_repo, commit_sha, skill_name, file_count, content_sha, created_at) =
            &raw_list[i];
        let previous_snapshot_id = if i + 1 < total && raw_list[i + 1].3 == *skill_name {
            Some(raw_list[i + 1].0.clone())
        } else {
            None
        };
        items_with_prev.push((
            snap_id.clone(),
            source_repo.clone(),
            commit_sha.clone(),
            skill_name.clone(),
            *file_count,
            content_sha.clone(),
            created_at.clone(),
            previous_snapshot_id,
        ));
    }

    let mut skills = Vec::new();
    for (
        snap_id,
        _source_repo,
        _commit_sha,
        skill_name,
        file_count,
        content_sha,
        created_at,
        previous_snapshot_id,
    ) in items_with_prev
    {
        let trans = skill_flow::load_translation(&layout.translations, &skill_name, Some(&snap_id))
            .ok()
            .flatten();
        let desc = trans
            .as_ref()
            .map(|t| t.purpose.clone())
            .unwrap_or_else(|| format!("{skill_name} ({file_count} 个文件)"));
        let tools = trans
            .as_ref()
            .map(|t| t.target_tools.clone())
            .unwrap_or_default();
        let zh = trans
            .as_ref()
            .map(|t| t.markdown_body.clone())
            .unwrap_or_default();

        let snap_dir = layout.skills.join("snapshots").join(&snap_id);
        let mut original = String::new();
        if snap_dir.exists() {
            if let Ok(files) = skill_flow::collect_files(&snap_dir) {
                for (rel, abs) in files {
                    if rel.eq_ignore_ascii_case("readme.md") || rel.eq_ignore_ascii_case("skill.md")
                    {
                        if let Ok(content) = std::fs::read_to_string(abs) {
                            original = content;
                            break;
                        }
                    }
                }
            }
        }
        if original.is_empty() {
            original = format!("# {skill_name}\n\n文件数量: {file_count}\n快照 ID: {snap_id}");
        }

        skills.push(SkillItemDto {
            id: snap_id.clone(),
            skill_name,
            desc,
            tools,
            updated: created_at,
            original,
            zh,
            snapshot_id: snap_id,
            previous_snapshot_id,
            file_count,
            content_sha,
        });
    }

    // 最终按更新时间降序展示
    skills.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(skills)
}
#[tauri::command]
pub async fn skill_batch_deploy_plan(
    snapshot_id: String,
    targets: Vec<skill_flow::DeploymentTarget>,
) -> Result<skill_flow::DeploymentPlan, String> {
    if !skill_flow::is_safe_id_segment(&snapshot_id) {
        return Err(format!("invalid snapshot_id: {snapshot_id}"));
    }
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    let snap_dir = layout.skills.join("snapshots").join(&snapshot_id);
    if !snap_dir.exists() {
        return Err(format!(
            "快照目录未找到: {snapshot_id} (路径: {})",
            snap_dir.display()
        ));
    }
    let skill_name = snapshot_id
        .split_once('-')
        .map(|(_, s)| s.to_string())
        .unwrap_or_else(|| snapshot_id.clone());
    let snap = skill_flow::Snapshot {
        id: snapshot_id.clone(),
        skill_name: skill_name.clone(),
        root_dir: snap_dir,
        file_count: 0,
        content_sha: "".into(),
    };
    let resolved_targets = skill_flow::resolve_deployment_targets(&targets, &skill_name, None);
    let managed_roots = crate::skills::allowed_deployment_roots(&layout);
    Ok(skill_flow::plan_batch_deployment(
        &conn,
        &snap,
        &resolved_targets,
        &managed_roots,
    ))
}

#[tauri::command]
pub async fn skill_batch_deploy_apply(
    snapshot_id: String,
    targets: Vec<skill_flow::DeploymentTarget>,
) -> Result<skill_flow::BatchDeployResult, String> {
    if !skill_flow::is_safe_id_segment(&snapshot_id) {
        return Err(format!("invalid snapshot_id: {snapshot_id}"));
    }
    let (layout, mut conn) = crate::platform::open_layout_and_db()?;
    let snap_dir = layout.skills.join("snapshots").join(&snapshot_id);
    if !snap_dir.exists() {
        return Err(format!("Snapshot {snapshot_id} directory not found"));
    }
    let content_sha = skill_flow::content_hash(&snap_dir).map_err(|e| e.to_string())?;
    let files = skill_flow::collect_files(&snap_dir).map_err(|e| e.to_string())?;
    let skill_name = snapshot_id
        .split_once('-')
        .map(|(_, s)| s.to_string())
        .unwrap_or_else(|| snapshot_id.clone());
    let snap = skill_flow::Snapshot {
        id: snapshot_id.clone(),
        skill_name: skill_name.clone(),
        root_dir: snap_dir,
        file_count: files.len(),
        content_sha,
    };
    let resolved_targets = skill_flow::resolve_deployment_targets(&targets, &skill_name, None);
    let managed_roots = crate::skills::allowed_deployment_roots(&layout);
    skill_flow::deploy_batch_planned(&mut conn, &snap, &resolved_targets, &managed_roots)
}
#[tauri::command]
pub async fn skills_scan_github(
    repo: String,
    git_ref: Option<String>,
    skill_path: Option<String>,
) -> Result<skill_flow::SkillRepoGroup, String> {
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    let token = crate::platform::credentials::get_github_token();
    // 先把分支名/HEAD 等可移动指针解析为真实 commit sha，再扫描与登记快照；
    // 否则快照 id 的版本段恒为 "HEAD"，上游更新后重扫无法形成新快照与 Diff。
    let resolved_sha = skill_flow::resolve_github_ref(&repo, git_ref.as_deref(), token.as_deref())?;
    let repo_dir = skill_flow::download_and_extract_github_repo(
        &repo,
        git_ref.as_deref(),
        token.as_deref(),
        &layout.staging,
    )?;

    let target_scan_path = if let Some(ref sp) = skill_path {
        let trimmed = sp.trim().trim_matches('/');
        if !trimmed.is_empty() {
            let sub = repo_dir.join(trimmed);
            if sub.is_dir() {
                sub
            } else {
                repo_dir.clone()
            }
        } else {
            repo_dir.clone()
        }
    } else {
        repo_dir.clone()
    };

    let group = skill_flow::scan_multi_skill_repo(
        &target_scan_path,
        &repo,
        &resolved_sha,
        Some(&layout.translations),
        Some(&layout.skills),
    )?;

    // 登记扫描快照元数据到 SQLite
    for sk in &group.skills {
        let snap_dir = layout.skills.join("snapshots").join(&sk.snapshot_id);
        if snap_dir.exists() {
            let snap = skill_flow::Snapshot {
                id: sk.snapshot_id.clone(),
                skill_name: sk.name.clone(),
                root_dir: snap_dir,
                file_count: sk.file_count,
                content_sha: sk.content_sha.clone(),
            };
            let src = skill_flow::SkillSource {
                repo: group.repo_name.clone(),
                commit_sha: group.commit_or_version.clone(),
                skill_path: sk.relative_path.clone(),
            };
            let _ = skill_flow::record_snapshot(&conn, &src, &snap);
        }
    }

    Ok(group)
}
#[tauri::command]
pub async fn skill_quarantine_list() -> Result<Vec<skill_flow::QuarantineItemDto>, String> {
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    skill_flow::list_quarantine_items(&conn, &layout.quarantine)
}

#[tauri::command]
pub async fn skill_quarantine_delete(quarantine_id: String) -> Result<(), String> {
    if !skill_flow::is_safe_id_segment(&quarantine_id) {
        return Err(format!("invalid quarantine_id: {quarantine_id}"));
    }
    let (layout, conn) = crate::platform::open_layout_and_db()?;
    skill_flow::delete_quarantine_item(&conn, &layout.quarantine, &quarantine_id)
}
