//! EvidenceStore 核心（content.md §8）。
//!
//! 证据是带来源的观察记录，概念键为
//! `skill_snapshot_id × target_host_id × host_version × deployment_scope × profile_version`。
//! 只追加，不覆盖；键输入变化时旧证据置 stale 而不是删除。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Discovered,
    Downloaded,
    StructurallyValidated,
    Configured,
    TargetDiscovered,
    SessionLoaded,
    CallableVerified,
}

impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Stage::Discovered => "discovered",
            Stage::Downloaded => "downloaded",
            Stage::StructurallyValidated => "structurally_validated",
            Stage::Configured => "configured",
            Stage::TargetDiscovered => "target_discovered",
            Stage::SessionLoaded => "session_loaded",
            Stage::CallableVerified => "callable_verified",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Success,
    Failure,
    Unknown,
    Stale,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Success => "success",
            Status::Failure => "failure",
            Status::Unknown => "unknown",
            Status::Stale => "stale",
        }
    }
}

/// 证据的五元组键。任一输入变化都会使后续证据失效。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceKey {
    pub skill_snapshot_id: String,
    pub target_host_id: String,
    pub host_version: String,
    pub deployment_scope: String,
    pub profile_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRecord {
    #[serde(flatten)]
    pub key: EvidenceKey,
    pub stage: Stage,
    pub status: Status,
    /// RFC 3339 UTC 时间戳。
    pub observed_at: String,
    /// 观察者标识（如 "aster-core"、连接器名）。
    pub observer: String,
    /// 观察对象内容摘要（哈希等），可为空。
    pub subject_digest: Option<String>,
    /// 可诊断信息；写入前必须已经过 logging::redact。
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StageStatus {
    pub stage: Stage,
    pub status: Status,
    pub observed_at: String,
}

/// 追加一条证据记录。成功即持久化；不做 upsert。
pub fn append(conn: &Connection, record: &EvidenceRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO evidence (skill_snapshot_id, target_host_id, host_version,
             deployment_scope, profile_version, stage, status, observed_at,
             observer, subject_digest, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            record.key.skill_snapshot_id,
            record.key.target_host_id,
            record.key.host_version,
            record.key.deployment_scope,
            record.key.profile_version,
            record.stage.as_str(),
            record.status.as_str(),
            record.observed_at,
            record.observer,
            record.subject_digest,
            record.detail,
        ],
    )?;
    Ok(())
}

/// 查询一个键当前各阶段的最新状态（每阶段取最新一条）。
pub fn latest_by_stage(conn: &Connection, key: &EvidenceKey) -> rusqlite::Result<Vec<StageStatus>> {
    let mut stmt = conn.prepare(
        "SELECT stage, status, observed_at FROM evidence e
         WHERE skill_snapshot_id = ?1 AND target_host_id = ?2 AND host_version = ?3
           AND deployment_scope = ?4 AND profile_version = ?5
           AND id = (SELECT MAX(id) FROM evidence e2
                     WHERE e2.skill_snapshot_id = e.skill_snapshot_id
                       AND e2.target_host_id = e.target_host_id
                       AND e2.host_version = e.host_version
                       AND e2.deployment_scope = e.deployment_scope
                       AND e2.profile_version = e.profile_version
                       AND e2.stage = e.stage)
         ORDER BY id",
    )?;
    let rows = stmt.query_map(
        params![
            key.skill_snapshot_id,
            key.target_host_id,
            key.host_version,
            key.deployment_scope,
            key.profile_version
        ],
        |row| {
            Ok(StageStatus {
                stage: parse_stage(row.get::<_, String>(0)?.as_str()).unwrap(),
                status: parse_status(row.get::<_, String>(1)?.as_str()).unwrap(),
                observed_at: row.get(2)?,
            })
        },
    )?;
    rows.collect()
}

/// 键输入变化时把该键所有非 stale 的记录置为 stale，返回受影响行数。
pub fn invalidate_key(conn: &Connection, key: &EvidenceKey) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE evidence SET status = 'stale'
         WHERE skill_snapshot_id = ?1 AND target_host_id = ?2 AND host_version = ?3
           AND deployment_scope = ?4 AND profile_version = ?5 AND status != 'stale'",
        params![
            key.skill_snapshot_id,
            key.target_host_id,
            key.host_version,
            key.deployment_scope,
            key.profile_version
        ],
    )
}

/// 证据总数（用于状态展示与迁移冒烟检查）。
pub fn count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM evidence", [], |row| row.get(0))
}

/// 读取一条键的最新记录的 stage 集合（供测试与诊断）。
pub fn latest_status_of_stage(
    conn: &Connection,
    key: &EvidenceKey,
    stage: Stage,
) -> rusqlite::Result<Option<Status>> {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM evidence
             WHERE skill_snapshot_id = ?1 AND target_host_id = ?2 AND host_version = ?3
               AND deployment_scope = ?4 AND profile_version = ?5 AND stage = ?6
             ORDER BY id DESC LIMIT 1",
            params![
                key.skill_snapshot_id,
                key.target_host_id,
                key.host_version,
                key.deployment_scope,
                key.profile_version,
                stage.as_str()
            ],
            |row| row.get(0),
        )
        .optional()?;
    Ok(status.and_then(|s| parse_status(&s)))
}

fn parse_stage(s: &str) -> Option<Stage> {
    Some(match s {
        "discovered" => Stage::Discovered,
        "downloaded" => Stage::Downloaded,
        "structurally_validated" => Stage::StructurallyValidated,
        "configured" => Stage::Configured,
        "target_discovered" => Stage::TargetDiscovered,
        "session_loaded" => Stage::SessionLoaded,
        "callable_verified" => Stage::CallableVerified,
        _ => return None,
    })
}

fn parse_status(s: &str) -> Option<Status> {
    Some(match s {
        "success" => Status::Success,
        "failure" => Status::Failure,
        "unknown" => Status::Unknown,
        "stale" => Status::Stale,
        _ => return None,
    })
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

    fn sample_key() -> EvidenceKey {
        EvidenceKey {
            skill_snapshot_id: "snap-1".into(),
            target_host_id: "pi".into(),
            host_version: "1.2.3".into(),
            deployment_scope: "user".into(),
            profile_version: "1".into(),
        }
    }

    fn sample_record(key: &EvidenceKey, stage: Stage, status: Status) -> EvidenceRecord {
        EvidenceRecord {
            key: key.clone(),
            stage,
            status,
            observed_at: "2026-08-16T00:00:00Z".into(),
            observer: "test".into(),
            subject_digest: Some("sha256:deadbeef".into()),
            detail: None,
        }
    }

    #[test]
    fn append_then_query_latest() {
        let conn = setup();
        let key = sample_key();
        append(&conn, &sample_record(&key, Stage::Downloaded, Status::Failure)).unwrap();
        append(&conn, &sample_record(&key, Stage::Downloaded, Status::Success)).unwrap();

        let latest = latest_by_stage(&conn, &key).unwrap();
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].stage, Stage::Downloaded);
        assert_eq!(latest[0].status, Status::Success);
    }

    #[test]
    fn different_key_is_isolated() {
        let conn = setup();
        let key = sample_key();
        let mut other = sample_key();
        other.host_version = "9.9.9".into();
        append(&conn, &sample_record(&key, Stage::Discovered, Status::Success)).unwrap();
        assert!(latest_by_stage(&conn, &other).unwrap().is_empty());
    }

    #[test]
    fn invalidate_marks_records_stale() {
        let conn = setup();
        let key = sample_key();
        append(&conn, &sample_record(&key, Stage::Discovered, Status::Success)).unwrap();
        append(&conn, &sample_record(&key, Stage::Downloaded, Status::Success)).unwrap();

        assert_eq!(invalidate_key(&conn, &key).unwrap(), 2);
        assert_eq!(
            latest_status_of_stage(&conn, &key, Stage::Downloaded).unwrap(),
            Some(Status::Stale)
        );
        // 再次失效没有可更新的行
        assert_eq!(invalidate_key(&conn, &key).unwrap(), 0);
        assert_eq!(count(&conn).unwrap(), 2, "invalidate 不删除历史");
    }
}
