use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::scan::StaticCheckFinding;
use super::snapshot::copy_tree;

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
pub struct QuarantineItemDto {
    pub id: i64,
    pub quarantine_id: String,
    pub source_info: String,
    pub reason: String,
    pub quarantined_at: String,
    pub quarantine_path: String,
    pub total_findings: usize,
    pub findings: Vec<StaticCheckFinding>,
}

pub fn list_quarantine_items(
    conn: &rusqlite::Connection,
    quarantine_root: &Path,
) -> Result<Vec<QuarantineItemDto>, String> {
    let records = crate::db::list_quarantine_records(conn).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for r in records {
        let manifest_file = quarantine_root.join(&r.quarantine_id).join("manifest.json");
        let mut total_findings = 0;
        let mut findings = Vec::new();
        if manifest_file.is_file() {
            if let Ok(content) = fs::read_to_string(&manifest_file) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    total_findings = val
                        .get("total_findings")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as usize;
                    if let Some(f_arr) = val.get("findings").and_then(|v| v.as_array()) {
                        if let Ok(parsed) =
                            serde_json::from_value(serde_json::Value::Array(f_arr.clone()))
                        {
                            findings = parsed;
                        }
                    }
                }
            }
        }
        items.push(QuarantineItemDto {
            id: r.id,
            quarantine_id: r.quarantine_id,
            source_info: r.source_info,
            reason: r.reason,
            quarantined_at: r.quarantined_at,
            quarantine_path: r.quarantine_path,
            total_findings,
            findings,
        });
    }
    Ok(items)
}

pub fn delete_quarantine_item(
    conn: &rusqlite::Connection,
    quarantine_root: &Path,
    quarantine_id: &str,
) -> Result<(), String> {
    let target_dir = quarantine_root.join(quarantine_id);
    if target_dir.exists() {
        let _ = fs::remove_dir_all(&target_dir);
    }
    crate::db::delete_quarantine_record(conn, quarantine_id).map_err(|e| e.to_string())?;
    Ok(())
}


pub fn quarantine_bad_skill(
    quarantine_root: &Path,
    source_info: &str,
    raw_dir: &Path,
    findings: &[StaticCheckFinding],
) -> Result<QuarantineRecord, String> {
    let now = Utc::now();
    let sanitized_source = source_info.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
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
