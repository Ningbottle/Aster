//! M0 集成测试：在真实临时目录上走一遍「布局创建 -> 文件数据库迁移 ->
//! 证据追加/查询/失效 -> 脱敏日志落盘」流程，不使用内存数据库。

use aster_lib::app_data::AppDataLayout;
use aster_lib::db;
use aster_lib::evidence::{self, EvidenceKey, EvidenceRecord, Stage, Status};
use aster_lib::logging::JsonlLogger;

#[test]
fn full_m0_flow_on_real_files() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    // 空数据库从版本 0 迁移到最新
    let db_path = layout.database.join("aster.db");
    assert!(!db_path.exists());
    let mut conn = db::open_connection(&db_path).unwrap();
    let v1 = db::migrate(&mut conn).unwrap();
    assert!(v1 >= 1);
    assert!(db_path.exists());

    // 再次打开并迁移是幂等的
    let conn2 = db::open_connection(&db_path).unwrap();
    assert_eq!(db::schema_version(&conn2).unwrap(), v1);

    // 证据追加、按五元组键隔离、失效置 stale
    let key = EvidenceKey {
        skill_snapshot_id: "snap-1".into(),
        target_host_id: "pi".into(),
        host_version: "0.0.0-test".into(),
        deployment_scope: "user".into(),
        profile_version: "1".into(),
    };
    evidence::append(
        &conn2,
        &EvidenceRecord {
            key: key.clone(),
            stage: Stage::Discovered,
            status: Status::Success,
            observed_at: "2026-08-16T00:00:00Z".into(),
            observer: "integration-test".into(),
            subject_digest: None,
            detail: None,
        },
    )
    .unwrap();
    assert_eq!(evidence::count(&conn2).unwrap(), 1);
    assert_eq!(evidence::latest_status_of_stage(&conn2, &key, Stage::Discovered).unwrap(), Some(Status::Success));
    assert_eq!(evidence::invalidate_key(&conn2, &key).unwrap(), 1);
    assert_eq!(evidence::latest_status_of_stage(&conn2, &key, Stage::Discovered).unwrap(), Some(Status::Stale));

    // 脱敏日志写入真实文件
    let logger = JsonlLogger::create(layout.logs.join("aster.jsonl")).unwrap();
    logger
        .log("info", "integration", r"path C:\Users\dave\repo token ghp_abc123def456")
        .unwrap();
    let content = std::fs::read_to_string(layout.logs.join("aster.jsonl")).unwrap();
    assert!(!content.contains("dave") && !content.contains("abc123def456"));
}
