//! M1 集成测试：在真实临时目录中验证
//! 「静态检查 -> 快照创建 -> 测试作用域部署 -> 证据链记录 -> 部署查询 -> 补偿回滚」全链路，
//! 不依赖外部网络。

use aster_lib::app_data::AppDataLayout;
use aster_lib::db;
use aster_lib::evidence::{Stage, Status};
use aster_lib::skill_flow::{self, DeploymentTarget, SkillSource};
use std::collections::BTreeMap;
use std::fs;

#[test]
fn test_m1_skill_deployment_evidence_and_rollback_flow() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    let mut conn = db::open_connection(&layout.database.join("aster.db")).unwrap();
    db::migrate(&mut conn).unwrap();

    // 1. 模拟解压后的合规 skill 目录
    let extracted_skill = layout.staging.join("extract-test").join("doc-coauthoring");
    fs::create_dir_all(&extracted_skill).unwrap();
    fs::write(
        extracted_skill.join("SKILL.md"),
        "---\nname: doc-coauthoring\ndescription: test skill\n---\n# Doc Co-authoring\n",
    )
    .unwrap();

    // 2. 静态检查
    let check_res = skill_flow::static_check(&extracted_skill);
    assert!(check_res.is_ok());
    let files = check_res.unwrap();
    assert_eq!(files.len(), 1);

    // 3. 不可变快照创建与记录
    let source = SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "00756142ab04c82a447693cf373c4e0c554d1005".into(),
        skill_path: "skills/doc-coauthoring".into(),
    };
    let snap = skill_flow::create_snapshot(&layout.skills, &source, &extracted_skill).unwrap();
    assert_eq!(snap.skill_name, "doc-coauthoring");
    skill_flow::record_snapshot(&conn, &source, &snap).unwrap();

    // 再次调用 create_snapshot 幂等复用
    let snap_reuse = skill_flow::create_snapshot(&layout.skills, &source, &extracted_skill).unwrap();
    assert_eq!(snap_reuse.id, snap.id);

    // 4. 部署到 Aster 管理的测试作用域
    let scope_dir = layout.runtimes.join("pi").join("test-scope");
    fs::create_dir_all(scope_dir.join("skills")).unwrap();
    let target = DeploymentTarget {
        host: "pi".into(),
        host_version: "0.84.2".into(),
        scope: "aster-test-scope".into(),
        path: scope_dir.join("skills").join(&snap.skill_name),
    };
    let dep_id = skill_flow::deploy(&conn, &snap, &target, &scope_dir).unwrap();
    assert!(target.path.join("SKILL.md").is_file());

    // 5. 记录证据链
    let mut stages = BTreeMap::new();
    stages.insert(Stage::Discovered, Status::Success);
    stages.insert(Stage::Downloaded, Status::Success);
    stages.insert(Stage::StructurallyValidated, Status::Success);
    stages.insert(Stage::Configured, Status::Success);
    stages.insert(Stage::TargetDiscovered, Status::Success);
    stages.insert(Stage::SessionLoaded, Status::Unknown);
    stages.insert(Stage::CallableVerified, Status::Unknown);
    skill_flow::record_evidence_chain(&conn, &snap.id, "pi", "0.84.2", "aster-test-scope", &stages).unwrap();

    // 6. 验证活跃部署查询
    let active = skill_flow::active_deployments_for_host(&conn, "pi").unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].0, dep_id);

    // 7. 回滚
    skill_flow::rollback(&conn, dep_id, &target.path).unwrap();
    assert!(!target.path.exists());
    let active_after = skill_flow::active_deployments_for_host(&conn, "pi").unwrap();
    assert!(active_after.is_empty());
}
