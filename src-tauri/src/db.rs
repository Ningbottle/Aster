//! SQLite 连接与版本化迁移。
//!
//! 迁移以 `PRAGMA user_version` 记录进度：每个迁移在事务内执行 SQL 并推进
//! 版本号。迁移只允许追加，不允许修改已发布条目（与 fixture/contract test
//! 的固定性要求一致）。

use rusqlite::Connection;
use std::path::Path;

/// 按顺序排列的迁移 SQL。索引 + 1 即目标 user_version。
/// 条目一经发布不可修改，只能追加新条目。
const MIGRATIONS: &[&str] = &[
    // 0001: 元数据表、Evidence 核心表与审计事件表。
    r#"
    CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE evidence (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_snapshot_id TEXT NOT NULL,
        target_host_id    TEXT NOT NULL,
        host_version      TEXT NOT NULL,
        deployment_scope  TEXT NOT NULL,
        profile_version   TEXT NOT NULL,
        stage             TEXT NOT NULL CHECK (stage IN (
            'discovered', 'downloaded', 'structurally_validated',
            'configured', 'target_discovered', 'session_loaded', 'callable_verified')),
        status            TEXT NOT NULL CHECK (status IN ('success', 'failure', 'unknown', 'stale')),
        observed_at       TEXT NOT NULL,
        observer          TEXT NOT NULL,
        subject_digest    TEXT,
        detail            TEXT
    );
    CREATE INDEX idx_evidence_key_stage
        ON evidence (skill_snapshot_id, target_host_id, host_version,
                     deployment_scope, profile_version, stage, id);

    CREATE TABLE audit_event (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      TEXT NOT NULL,
        kind    TEXT NOT NULL,
        subject TEXT NOT NULL,
        detail  TEXT
    );
    "#,
    // 0002: Skill 快照、部署与 Pi 安装记录（M1）。
    r#"
    CREATE TABLE skill_snapshot (
        id          TEXT PRIMARY KEY,
        source_repo TEXT NOT NULL,
        commit_sha  TEXT NOT NULL,
        skill_path  TEXT NOT NULL,
        skill_name  TEXT NOT NULL,
        root_dir    TEXT NOT NULL,
        file_count  INTEGER NOT NULL,
        content_sha TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );

    CREATE TABLE skill_deployment (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id  TEXT NOT NULL REFERENCES skill_snapshot(id),
        target_host  TEXT NOT NULL,
        host_version TEXT NOT NULL,
        scope        TEXT NOT NULL,
        target_path  TEXT NOT NULL,
        state        TEXT NOT NULL CHECK (state IN ('deployed', 'rolled_back')),
        deployed_at  TEXT NOT NULL,
        rolled_back_at TEXT
    );
    CREATE INDEX idx_deployment_snapshot ON skill_deployment (snapshot_id, target_host, host_version, scope);

    CREATE TABLE host_install (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        host         TEXT NOT NULL,
        kind         TEXT NOT NULL CHECK (kind IN ('managed', 'recognized_external')),
        version      TEXT NOT NULL,
        program_path TEXT NOT NULL,
        discovered_at TEXT NOT NULL
    );
    "#,
    // 0003: 中文说明索引与安全隔离归档记录（M3）。
    r#"
    CREATE TABLE skill_translation (
        id          TEXT PRIMARY KEY,
        skill_name  TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        purpose     TEXT,
        updated_at  TEXT NOT NULL
    );

    CREATE TABLE skill_quarantine (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        quarantine_id   TEXT NOT NULL,
        source_info     TEXT NOT NULL,
        reason          TEXT NOT NULL,
        quarantine_path TEXT NOT NULL,
        quarantined_at  TEXT NOT NULL
    );
    "#,
];

#[derive(Debug)]
pub struct MigrationError {
    pub from_version: u32,
    pub message: String,
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "migration from schema version {} failed: {}",
            self.from_version, self.message
        )
    }
}

impl std::error::Error for MigrationError {}

pub fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

/// 应用所有未应用的迁移，返回当前 schema 版本。空数据库会从 0 迁移到最新。
pub fn migrate(conn: &mut Connection) -> Result<u32, MigrationError> {
    let current: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| MigrationError {
            from_version: 0,
            message: format!("reading user_version: {e}"),
        })?;

    // 数据库版本高于本二进制支持的版本，说明它由更新的 Aster 创建。
    // 不回退、不猜测，直接报错交给上层呈现。
    if current > MIGRATIONS.len() as u32 {
        return Err(MigrationError {
            from_version: current,
            message: format!(
                "database schema version {current} is newer than this build supports ({}); \
                 use a newer Aster build",
                MIGRATIONS.len()
            ),
        });
    }

    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let target = (i + 1) as u32;
        let tx = conn.transaction().map_err(|e| MigrationError {
            from_version: current,
            message: format!("begin transaction: {e}"),
        })?;
        tx.execute_batch(sql)
            .map_err(|e| MigrationError {
                from_version: current,
                message: format!("applying migration {target}: {e}"),
            })?;
        tx.pragma_update(None, "user_version", target)
            .and_then(|_| tx.commit())
            .map_err(|e| MigrationError {
                from_version: current,
                message: format!("committing migration {target}: {e}"),
            })?;
    }

    Ok(MIGRATIONS.len() as u32)
}

/// 只读查询当前版本，不修改数据库。
pub fn schema_version(conn: &Connection) -> rusqlite::Result<u32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

/// 记录宿主运行时的安装/发现信息到 host_install 表中。
pub fn record_host_install(
    conn: &Connection,
    host: &str,
    kind: &str,
    version: &str,
    program_path: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO host_install (host, kind, version, program_path, discovered_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            host,
            kind,
            version,
            program_path,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_empty_database_to_latest() {
        let mut conn = Connection::open_in_memory().unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 0);
        let v = migrate(&mut conn).unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
        assert_eq!(schema_version(&conn).unwrap(), v);
        // 关键表存在
        conn.execute("SELECT 1 FROM meta LIMIT 1", []).unwrap();
        conn.execute("SELECT 1 FROM evidence LIMIT 1", []).unwrap();
        conn.execute("SELECT 1 FROM audit_event LIMIT 1", []).unwrap();
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        let first = migrate(&mut conn).unwrap();
        let second = migrate(&mut conn).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn partially_migrated_database_advances_only_pending() {
        // 真实场景：库只应用过 0001（版本 1），再迁移应只应用 0002。
        let mut conn = Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute_batch(MIGRATIONS[0]).unwrap();
        tx.pragma_update(None, "user_version", 1).unwrap();
        tx.commit().unwrap();
        let v = migrate(&mut conn).unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
        // 0002 的表存在
        conn.execute("SELECT 1 FROM skill_snapshot LIMIT 1", []).unwrap();
    }

    #[test]
    fn database_newer_than_code_is_reported_not_downgraded() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        let err = migrate(&mut conn).unwrap_err();
        assert_eq!(err.from_version, 999);
    }
}
