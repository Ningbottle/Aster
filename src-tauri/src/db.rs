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
    // 0004: 最近项目与每宿主工作目录覆盖（R3）。
    r#"
    CREATE TABLE recent_project (
        path           TEXT PRIMARY KEY,
        display_name   TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
    );

    CREATE TABLE host_workdir (
        host TEXT PRIMARY KEY,
        path TEXT NOT NULL
    );
    "#,
    // 0005: rebuildable Pi native-session index (metadata only; never conversation text).
    r#"
    CREATE TABLE pi_session_index (
        session_id       TEXT PRIMARY KEY,
        project_path     TEXT NOT NULL,
        session_rel_path TEXT NOT NULL UNIQUE,
        session_name     TEXT,
        created_at       TEXT NOT NULL,
        modified_at      TEXT NOT NULL,
        message_count    INTEGER NOT NULL DEFAULT 0,
        availability     TEXT NOT NULL CHECK (availability IN (
            'available', 'missing', 'project_missing', 'unsupported')),
        last_seen_at     TEXT NOT NULL
    );
    CREATE INDEX idx_pi_session_project_modified
        ON pi_session_index (project_path, modified_at DESC);
    "#,
];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecentProjectRecord {
    pub path: String,
    pub display_name: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QuarantineDbRecord {
    pub id: i64,
    pub quarantine_id: String,
    pub source_info: String,
    pub reason: String,
    pub quarantine_path: String,
    pub quarantined_at: String,
}

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
        tx.execute_batch(sql).map_err(|e| MigrationError {
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

pub fn record_recent_project(
    conn: &Connection,
    path: &str,
    display_name: &str,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO recent_project (path, display_name, last_opened_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET display_name = ?2, last_opened_at = ?3",
        rusqlite::params![path, display_name, now],
    )?;
    Ok(())
}

pub fn list_recent_projects(conn: &Connection) -> rusqlite::Result<Vec<RecentProjectRecord>> {
    let mut stmt = conn.prepare(
        "SELECT path, display_name, last_opened_at FROM recent_project ORDER BY last_opened_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(RecentProjectRecord {
            path: row.get(0)?,
            display_name: row.get(1)?,
            last_opened_at: row.get(2)?,
        })
    })?;
    let mut res = Vec::new();
    for r in rows {
        res.push(r?);
    }
    Ok(res)
}

pub fn remove_recent_project(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM recent_project WHERE path = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}

pub fn get_active_project(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM meta WHERE key = 'active_project'")?;
    let mut rows = stmt.query_map([], |row| row.get(0))?;
    if let Some(r) = rows.next() {
        Ok(Some(r?))
    } else {
        Ok(None)
    }
}

pub fn set_active_project(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('active_project', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}

pub fn set_host_workdir(conn: &Connection, host: &str, path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO host_workdir (host, path) VALUES (?1, ?2)
         ON CONFLICT(host) DO UPDATE SET path = ?2",
        rusqlite::params![host, path],
    )?;
    Ok(())
}

pub fn get_host_workdir(conn: &Connection, host: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT path FROM host_workdir WHERE host = ?1")?;
    let mut rows = stmt.query_map(rusqlite::params![host], |row| row.get(0))?;
    if let Some(r) = rows.next() {
        Ok(Some(r?))
    } else {
        Ok(None)
    }
}

/// 写入一条隔离记录（id 由 SQLite 自增分配）。
///
/// 读取端 `list_quarantine_records` 只查本表；`skill_flow::quarantine_bad_skill`
/// 只写文件系统并返回记录，调用方必须经此函数把记录桥接进 DB，否则隔离区
/// UI 永远看不到文件系统里已存在的隔离样本。
pub fn insert_quarantine_record(
    conn: &Connection,
    quarantine_id: &str,
    source_info: &str,
    reason: &str,
    quarantine_path: &str,
    quarantined_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO skill_quarantine (quarantine_id, source_info, reason, quarantine_path, quarantined_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![quarantine_id, source_info, reason, quarantine_path, quarantined_at],
    )?;
    Ok(())
}

pub fn list_quarantine_records(conn: &Connection) -> rusqlite::Result<Vec<QuarantineDbRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, quarantine_id, source_info, reason, quarantine_path, quarantined_at
         FROM skill_quarantine ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(QuarantineDbRecord {
            id: row.get(0)?,
            quarantine_id: row.get(1)?,
            source_info: row.get(2)?,
            reason: row.get(3)?,
            quarantine_path: row.get(4)?,
            quarantined_at: row.get(5)?,
        })
    })?;
    let mut res = Vec::new();
    for r in rows {
        res.push(r?);
    }
    Ok(res)
}

pub fn delete_quarantine_record(conn: &Connection, quarantine_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM skill_quarantine WHERE quarantine_id = ?1",
        rusqlite::params![quarantine_id],
    )?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct PiSessionIndexRecord {
    pub session_id: String,
    pub project_path: String,
    pub session_rel_path: String,
    pub session_name: Option<String>,
    pub created_at: String,
    pub modified_at: String,
    pub message_count: i64,
    pub availability: String,
    pub last_seen_at: String,
}

fn map_pi_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PiSessionIndexRecord> {
    Ok(PiSessionIndexRecord {
        session_id: row.get(0)?,
        project_path: row.get(1)?,
        session_rel_path: row.get(2)?,
        session_name: row.get(3)?,
        created_at: row.get(4)?,
        modified_at: row.get(5)?,
        message_count: row.get(6)?,
        availability: row.get(7)?,
        last_seen_at: row.get(8)?,
    })
}

pub fn upsert_pi_session(conn: &Connection, record: &PiSessionIndexRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO pi_session_index (
            session_id, project_path, session_rel_path, session_name,
            created_at, modified_at, message_count, availability, last_seen_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(session_id) DO UPDATE SET
            project_path = excluded.project_path,
            session_rel_path = excluded.session_rel_path,
            session_name = excluded.session_name,
            modified_at = excluded.modified_at,
            message_count = excluded.message_count,
            availability = excluded.availability,
            last_seen_at = excluded.last_seen_at",
        rusqlite::params![
            record.session_id,
            record.project_path,
            record.session_rel_path,
            record.session_name,
            record.created_at,
            record.modified_at,
            record.message_count,
            record.availability,
            record.last_seen_at,
        ],
    )?;
    Ok(())
}

pub fn list_pi_sessions_for_project(
    conn: &Connection,
    project_path: &str,
) -> rusqlite::Result<Vec<PiSessionIndexRecord>> {
    let mut stmt = conn.prepare(
        "SELECT session_id, project_path, session_rel_path, session_name,
                created_at, modified_at, message_count, availability, last_seen_at
         FROM pi_session_index
         WHERE project_path = ?1
         ORDER BY modified_at DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![project_path], map_pi_session_row)?;
    let mut res = Vec::new();
    for r in rows {
        res.push(r?);
    }
    Ok(res)
}

pub fn list_pi_session_index(conn: &Connection) -> rusqlite::Result<Vec<PiSessionIndexRecord>> {
    let mut stmt = conn.prepare(
        "SELECT session_id, project_path, session_rel_path, session_name,
                created_at, modified_at, message_count, availability, last_seen_at
         FROM pi_session_index
         ORDER BY project_path ASC, modified_at DESC",
    )?;
    let rows = stmt.query_map([], map_pi_session_row)?;
    let mut res = Vec::new();
    for r in rows {
        res.push(r?);
    }
    Ok(res)
}

pub fn get_pi_session(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<PiSessionIndexRecord>> {
    let mut stmt = conn.prepare(
        "SELECT session_id, project_path, session_rel_path, session_name,
                created_at, modified_at, message_count, availability, last_seen_at
         FROM pi_session_index
         WHERE session_id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![session_id], map_pi_session_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Mark index rows whose `session_id` was not observed in the latest scan.
pub fn mark_pi_sessions_unseen(
    conn: &Connection,
    seen_session_ids: &[String],
) -> rusqlite::Result<usize> {
    if seen_session_ids.is_empty() {
        return conn.execute(
            "UPDATE pi_session_index SET availability = 'missing' WHERE availability = 'available'",
            [],
        );
    }
    let placeholders = seen_session_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "UPDATE pi_session_index SET availability = 'missing'
         WHERE availability = 'available' AND session_id NOT IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = seen_session_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    stmt.execute(params.as_slice())
}

pub fn mark_pi_session_missing(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pi_session_index SET availability = 'missing' WHERE session_id = ?1",
        rusqlite::params![session_id],
    )?;
    Ok(())
}

pub fn mark_pi_session_project_missing(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pi_session_index SET availability = 'project_missing' WHERE session_id = ?1",
        rusqlite::params![session_id],
    )?;
    Ok(())
}

/// Delete only the Aster index row. Never deletes a native Pi JSONL file.
pub fn remove_pi_session_index(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM pi_session_index WHERE session_id = ?1",
        rusqlite::params![session_id],
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
        conn.execute("SELECT 1 FROM audit_event LIMIT 1", [])
            .unwrap();
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
        conn.execute("SELECT 1 FROM skill_snapshot LIMIT 1", [])
            .unwrap();
    }

    #[test]
    fn database_newer_than_code_is_reported_not_downgraded() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        let err = migrate(&mut conn).unwrap_err();
        assert_eq!(err.from_version, 999);
    }

    #[test]
    fn migration_0004_recent_projects_and_workdirs() {
        let mut conn = Connection::open_in_memory().unwrap();
        let v = migrate(&mut conn).unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
        conn.execute("SELECT 1 FROM recent_project LIMIT 1", [])
            .unwrap();
        conn.execute("SELECT 1 FROM host_workdir LIMIT 1", [])
            .unwrap();

        // 1. 最近项目 CRUD
        record_recent_project(&conn, "C:/Projects/Aster", "Aster").unwrap();
        record_recent_project(&conn, "C:/Projects/Foo", "Foo").unwrap();
        let list = list_recent_projects(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].display_name, "Foo"); // latest opened first

        remove_recent_project(&conn, "C:/Projects/Foo").unwrap();
        let list2 = list_recent_projects(&conn).unwrap();
        assert_eq!(list2.len(), 1);
        assert_eq!(list2[0].path, "C:/Projects/Aster");

        // 2. 活动项目
        assert_eq!(get_active_project(&conn).unwrap(), None);
        set_active_project(&conn, "C:/Projects/Aster").unwrap();
        assert_eq!(
            get_active_project(&conn).unwrap(),
            Some("C:/Projects/Aster".into())
        );

        // 3. 宿主工作目录覆盖
        assert_eq!(get_host_workdir(&conn, "pi").unwrap(), None);
        set_host_workdir(&conn, "pi", "C:/CustomPi").unwrap();
        assert_eq!(
            get_host_workdir(&conn, "pi").unwrap(),
            Some("C:/CustomPi".into())
        );

        // 4. 隔离区记录（insert -> list -> delete 闭环）
        insert_quarantine_record(
            &conn,
            "q-1",
            "bad-repo",
            "contains bad.exe",
            "C:/quarantine/q-1",
            "2026-08-18T12:00:00Z",
        )
        .unwrap();
        let q_list = list_quarantine_records(&conn).unwrap();
        assert_eq!(q_list.len(), 1);
        assert_eq!(q_list[0].quarantine_id, "q-1");

        delete_quarantine_record(&conn, "q-1").unwrap();
        let q_list2 = list_quarantine_records(&conn).unwrap();
        assert_eq!(q_list2.len(), 0);
    }

    #[test]
    fn migration_0005_pi_session_index_round_trips_without_conversation_text() {
        let mut conn = open_connection(Path::new(":memory:")).unwrap();
        assert_eq!(migrate(&mut conn).unwrap(), 5);

        let sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='pi_session_index'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lower = sql.to_lowercase();
        assert!(!lower.contains("conversation"));
        assert!(!lower.contains("prompt"));
        assert!(!lower.contains("tool_output"));
    }

    fn fixture_session(
        id: &str,
        project: &str,
        rel: &str,
        name: Option<&str>,
        modified_at: &str,
        count: i64,
    ) -> PiSessionIndexRecord {
        PiSessionIndexRecord {
            session_id: id.into(),
            project_path: project.into(),
            session_rel_path: rel.into(),
            session_name: name.map(str::to_string),
            created_at: "2026-08-19T00:00:00Z".into(),
            modified_at: modified_at.into(),
            message_count: count,
            availability: "available".into(),
            last_seen_at: "2026-08-19T12:00:00Z".into(),
        }
    }

    #[test]
    fn pi_session_index_upsert_order_missing_and_index_only_removal() {
        let mut conn = open_connection(Path::new(":memory:")).unwrap();
        migrate(&mut conn).unwrap();

        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("s-old.jsonl");
        std::fs::write(&jsonl, "{\"type\":\"session\"}\n").unwrap();

        let project = r"C:\fixture\project-a";
        upsert_pi_session(
            &conn,
            &fixture_session(
                "s-old",
                project,
                "cwd-a/s-old.jsonl",
                Some("older"),
                "2026-08-18T00:00:00Z",
                1,
            ),
        )
        .unwrap();
        upsert_pi_session(
            &conn,
            &fixture_session(
                "s-new",
                project,
                "cwd-a/s-new.jsonl",
                None,
                "2026-08-19T00:00:00Z",
                2,
            ),
        )
        .unwrap();

        let listed = list_pi_sessions_for_project(&conn, project).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].session_id, "s-new");
        assert_eq!(listed[1].session_id, "s-old");

        let mut renamed = listed[0].clone();
        renamed.session_name = Some("Plan compiler".into());
        renamed.message_count = 4;
        upsert_pi_session(&conn, &renamed).unwrap();
        let listed = list_pi_sessions_for_project(&conn, project).unwrap();
        assert_eq!(listed[0].session_name.as_deref(), Some("Plan compiler"));
        assert_eq!(listed[0].message_count, 4);

        mark_pi_session_missing(&conn, "s-old").unwrap();
        let listed = list_pi_sessions_for_project(&conn, project).unwrap();
        assert_eq!(listed[1].availability, "missing");

        mark_pi_sessions_unseen(&conn, &["s-new".into()]).unwrap();
        let listed = list_pi_sessions_for_project(&conn, project).unwrap();
        assert_eq!(listed[0].availability, "available");
        assert_eq!(listed[1].availability, "missing");

        remove_pi_session_index(&conn, "s-old").unwrap();
        let listed = list_pi_sessions_for_project(&conn, project).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].session_id, "s-new");
        assert!(
            jsonl.is_file(),
            "index removal must not delete the JSONL fixture"
        );
    }
}
