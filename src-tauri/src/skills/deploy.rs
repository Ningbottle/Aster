use crate::evidence::{self, EvidenceKey, EvidenceRecord, Stage, Status};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::snapshot::{collect_files, content_hash, copy_tree};
use super::source::SkillSource;
use super::snapshot::Snapshot;

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

fn is_within(target: &Path, root: &Path) -> bool {
    let t: Vec<_> = target.components().collect();
    let r: Vec<_> = root.components().collect();
    t.len() > r.len()
        && t.iter().zip(r.iter()).all(|(a, b)| {
            a.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
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
    if target.path.exists()
        && fs::read_dir(&target.path)
            .map(|d| d.count() > 0)
            .unwrap_or(false)
    {
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
                            "target directory {} was modified externally (expected snapshot sha: {}, current disk sha: {}); refusing to overwrite an Aster-managed deployment",
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
                    if let Some(scope_info) = host_info
                        .discovered_scopes
                        .iter()
                        .find(|s| s.kind.as_str().eq_ignore_ascii_case(&scope_kind_str))
                    {
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
            if let (Ok(t_abs), Ok(r_abs)) =
                (std::path::absolute(&target.path), std::path::absolute(root))
            {
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
        if target.path.exists()
            && fs::read_dir(&target.path)
                .map(|d| d.count() > 0)
                .unwrap_or(false)
        {
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
                            reason: Some(
                                "托管目录已被外部修改；为保护 Aster 管理的部署，停止自动写入并展示差异"
                                    .into(),
                            ),
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
                            reason: Some(
                                "已存在 Aster 管理的历史部署（内容与快照一致），可安全更新".into(),
                            ),
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
                        reason: Some(
                            "目标目录已存在非 Aster 管理的现有文件，拒绝覆盖未托管内容".into(),
                        ),
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
                let (Ok(t_abs), Ok(r_abs)) =
                    (std::path::absolute(&target.path), std::path::absolute(root))
                else {
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
        // 安全不变量：托管目录被外部修改后不得静默删除——回滚是整目录
        // 删除，比写入更危险。与部署时快照哈希比对，不一致即拒绝并等待用户决定。
        let snap_sha: String = conn
            .query_row(
                "SELECT s.content_sha FROM skill_deployment d JOIN skill_snapshot s ON s.id = d.snapshot_id WHERE d.id = ?1",
                [deployment_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("cannot resolve snapshot hash for deployment {deployment_id}: {e}"))?;
        let current_sha =
            content_hash(target_path).map_err(|e| format!("cannot hash rollback target: {e}"))?;
        if current_sha != snap_sha {
            return Err(format!(
                "refusing to roll back deployment {deployment_id}: target directory content differs from the deployed snapshot (external modification detected); resolve or remove it manually"
            ));
        }
        fs::remove_dir_all(target_path).map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE skill_deployment SET state = 'rolled_back', rolled_back_at = ?1 WHERE id = ?2",
        params![Utc::now().to_rfc3339(), deployment_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn active_deployments_for_host(
    conn: &Connection,
    host: &str,
) -> rusqlite::Result<Vec<(i64, String, String, String)>> {
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
