//! M3 集成测试：
//! 在真实临时文件系统和 SQLite 数据库中完整演练 Milestone M3 全套广度能力：
//! 1. 11 个宿主工具 Profiles 静态事实与本地扫描
//! 2. 多 Skill 仓库结构化解析与分组
//! 3. 恶意脚本/二进制安全拦截与 Quarantine 分区隔离
//! 4. 不可变快照版本间 Unified Diff
//! 5. 中文派生说明（Translations）生命周期与快照升级过期提示
//! 6. 多目标批量部署计划（Plan & Apply）
//! 7. 外部未托管冲突拦截与执行失败补偿回滚（Compensating Rollback）
//! 8. 分级 Evidence 记录验证

use aster_lib::app_data::AppDataLayout;
use aster_lib::db;
use aster_lib::evidence::{self, EvidenceKey, Stage, Status};
use aster_lib::host_profile;
use aster_lib::skill_flow::{
    self, DeploymentTarget, SkillSource, TranslationDoc,
};
use chrono::Utc;
use std::fs;
use std::path::Path;

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

#[test]
fn test_m3_skills_manager_breadth_flow() {
    let tmp = tempfile::tempdir().unwrap();
    let layout = AppDataLayout::open(tmp.path()).unwrap();

    let mut conn = db::open_connection(&layout.database.join("aster.db")).unwrap();
    let schema_v = db::migrate(&mut conn).unwrap();
    assert_eq!(schema_v, 3, "Schema 版本应迁移至 0003");

    // 1. 11 个宿主工具 Profile 与扫描
    let profiles = host_profile::all_profiles();
    assert_eq!(profiles.len(), 11);
    let discovered = host_profile::scan_all_hosts(Some(tmp.path()));
    assert_eq!(discovered.len(), 11);

    // 2. 多 Skill 仓库扫描与分组
    let repo_dir = layout.staging.join("multi-repo");
    fs::create_dir_all(&repo_dir).unwrap();

    write_file(
        &repo_dir.join("skills/doc-writer/SKILL.md"),
        "---\nname: doc-writer\ndescription: Document generator\n---\n# Doc Writer\nLine 1\n",
    );
    write_file(
        &repo_dir.join("skills/code-fixer/SKILL.md"),
        "---\nname: code-fixer\ndescription: Bug fixer\n---\n# Code Fixer\nFixes issues\n",
    );
    write_file(
        &repo_dir.join("skills/dangerous-skill/SKILL.md"),
        "# Dangerous\nHas binary\n",
    );
    write_file(
        &repo_dir.join("skills/dangerous-skill/script.bat"),
        "@echo off\n",
    );

    let group = skill_flow::scan_multi_skill_repo(
        &repo_dir,
        "anthropics/skills",
        "1234567890ab",
        Some(&layout.translations),
        None,
    )
    .unwrap();
    assert_eq!(group.skills.len(), 3);
    assert_eq!(group.source_type, "github");
    assert!(group.skills.iter().all(|s| s.snapshot_id.starts_with("1234567890ab-")));
    assert!(group.skills.iter().any(|s| s.name == "doc-writer"));
    assert!(group.skills.iter().any(|s| s.name == "code-fixer"));
    assert!(group.skills.iter().any(|s| s.name == "dangerous-skill"));

    // 3. 安全扫描拦截与 Quarantine 隔离
    let dangerous_dir = repo_dir.join("skills/dangerous-skill");
    let check_res = skill_flow::static_check(&dangerous_dir);
    assert!(check_res.is_err(), "包含 .bat 脚本的 Skill 必须被静态检查拦截");
    let findings = check_res.unwrap_err();

    let q_rec = skill_flow::quarantine_bad_skill(
        &layout.quarantine,
        "anthropics/skills/dangerous-skill",
        &dangerous_dir,
        &findings,
    )
    .unwrap();
    assert!(Path::new(&q_rec.quarantine_path).join("manifest.json").is_file());
    assert!(Path::new(&q_rec.quarantine_path).join("content/script.bat").is_file());
    assert!(!dangerous_dir.exists(), "原 staging 目录必须被完全移除");

    // 4. 不可变快照创建与快照 Diff
    let doc_src_v1 = SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "111111111111".into(),
        skill_path: "skills/doc-writer".into(),
    };
    let doc_writer_dir = repo_dir.join("skills/doc-writer");
    let snap_v1 = skill_flow::create_snapshot(&layout.skills, &doc_src_v1, &doc_writer_dir).unwrap();
    skill_flow::record_snapshot(&conn, &doc_src_v1, &snap_v1).unwrap();

    // 模拟 v2 版本的改动
    write_file(
        &doc_writer_dir.join("SKILL.md"),
        "---\nname: doc-writer\ndescription: Document generator v2\n---\n# Doc Writer\nLine 1 modified\n",
    );
    write_file(&doc_writer_dir.join("template.txt"), "Standard template\n");

    let doc_src_v2 = SkillSource {
        repo: "anthropics/skills".into(),
        commit_sha: "222222222222".into(),
        skill_path: "skills/doc-writer".into(),
    };
    let snap_v2 = skill_flow::create_snapshot(&layout.skills, &doc_src_v2, &doc_writer_dir).unwrap();
    skill_flow::record_snapshot(&conn, &doc_src_v2, &snap_v2).unwrap();

    let diff = skill_flow::snapshot_diff(&snap_v1.root_dir, &snap_v2.root_dir, &snap_v1.id, &snap_v2.id).unwrap();
    assert_eq!(diff.added_files, vec!["template.txt"]);
    assert_eq!(diff.modified_files, vec!["SKILL.md"]);
    assert!(diff.deleted_files.is_empty());
    assert!(diff.file_diffs.iter().any(|fd| fd.path == "SKILL.md" && fd.status == "modified"));

    // 5. 中文派生说明（Translations）生命周期
    let tr_doc = TranslationDoc {
        skill_name: "doc-writer".into(),
        snapshot_id: snap_v1.id.clone(),
        purpose: "用于自动生成与协作编写设计文档".into(),
        applicable_tasks: "文档撰写、格式化、审查".into(),
        target_tools: vec!["pi".into(), "cursor".into(), "antigravity".into()],
        prerequisites: "无特定要求".into(),
        risks: "纯文档处理，无运行时副作用".into(),
        author: "tester".into(),
        updated_at: Utc::now().to_rfc3339(),
        markdown_body: "# 中文说明\n这是用户编写的文档说明。".into(),
        is_stale: false,
    };
    skill_flow::save_translation(Some(&conn), &layout.translations, &tr_doc).unwrap();

    // 在 v1 快照下读取：非 stale
    let loaded_v1 = skill_flow::load_translation(&layout.translations, "doc-writer", Some(&snap_v1.id)).unwrap().unwrap();
    assert!(!loaded_v1.is_stale);

    // 在 v2 快照下读取：触发 is_stale: true，但正文完整保留
    let loaded_v2 = skill_flow::load_translation(&layout.translations, "doc-writer", Some(&snap_v2.id)).unwrap().unwrap();
    assert!(loaded_v2.is_stale, "快照变更时必须提示说明已过期");
    assert_eq!(loaded_v2.purpose, "用于自动生成与协作编写设计文档");

    // 6. 多目标批量部署规划与未托管拦截
    let managed_root = layout.runtimes.join("test-managed-env");
    fs::create_dir_all(&managed_root).unwrap();

    let target_pi = DeploymentTarget {
        host: "pi".into(),
        host_version: "0.84.2".into(),
        scope: "user".into(),
        path: managed_root.join("pi-skills/doc-writer"),
    };
    let target_cursor = DeploymentTarget {
        host: "cursor".into(),
        host_version: "1.0.0".into(),
        scope: "project".into(),
        path: managed_root.join("cursor-skills/doc-writer"),
    };
    let target_antigravity = DeploymentTarget {
        host: "antigravity".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("antigravity-skills/doc-writer"),
    };

    // 6.1 构造外部未托管冲突目录
    let unmanaged_dir = managed_root.join("unmanaged-zed-skills/doc-writer");
    write_file(&unmanaged_dir.join("existing_user_doc.txt"), "Important user files");

    let target_conflict = DeploymentTarget {
        host: "zed".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: unmanaged_dir,
    };

    let blocked_plan = skill_flow::plan_batch_deployment(
        &conn,
        &snap_v2,
        &[target_pi.clone(), target_cursor.clone(), target_conflict],
        std::slice::from_ref(&managed_root),
    );
    assert!(!blocked_plan.can_apply, "包含外部冲突目标的计划必须被阻止");
    assert_eq!(blocked_plan.blocked_targets, 1);

    // 7. 合法目标的批量部署（Plan & Apply）与分级 Evidence 记录
    let valid_targets = [target_pi.clone(), target_cursor.clone(), target_antigravity.clone()];
    let plan = skill_flow::plan_batch_deployment(&conn, &snap_v2, &valid_targets, std::slice::from_ref(&managed_root));
    assert!(plan.can_apply);
    assert_eq!(plan.ready_targets, 3);

    let deploy_res = skill_flow::deploy_batch_planned(&mut conn, &snap_v2, &valid_targets, std::slice::from_ref(&managed_root)).unwrap();
    assert!(deploy_res.success);
    assert_eq!(deploy_res.deployed_count, 3);
    assert!(target_pi.path.join("template.txt").is_file());
    assert!(target_cursor.path.join("template.txt").is_file());
    assert!(target_antigravity.path.join("template.txt").is_file());

    // 8. 验证分级 Evidence
    let key_cursor = EvidenceKey {
        skill_snapshot_id: snap_v2.id.clone(),
        target_host_id: "cursor".into(),
        host_version: "1.0.0".into(),
        deployment_scope: "project".into(),
        profile_version: "cursor-v1".into(),
    };
    let cursor_stages = evidence::latest_by_stage(&conn, &key_cursor).unwrap();
    assert!(cursor_stages.iter().any(|s| s.stage == Stage::TargetDiscovered && s.status == Status::Success));
    assert!(cursor_stages.iter().any(|s| s.stage == Stage::SessionLoaded && s.status == Status::Unknown));

    // 9. 补偿回滚测试（Compensating Rollback on Runtime Failure）
    let fail_parent = managed_root.join("blocked_parent_dir");
    write_file(&fail_parent, "blocking regular file"); // 使 create_dir_all 失败

    let target_extra_1 = DeploymentTarget {
        host: "kimi-code".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("kimi-skills/doc-writer"),
    };
    let target_extra_fail = DeploymentTarget {
        host: "zed".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: fail_parent.join("doc-writer"),
    };

    let fail_batch = [target_extra_1.clone(), target_extra_fail];
    let batch_res = skill_flow::deploy_batch_planned(&mut conn, &snap_v2, &fail_batch, std::slice::from_ref(&managed_root)).unwrap();
    assert!(!batch_res.success);
    assert_eq!(batch_res.deployed_count, 0);
    assert_eq!(batch_res.rolled_back_count, 1, "先前已部署的 kimi-code 必须被补偿回滚");
    assert!(!target_extra_1.path.exists(), "回滚后目标路径不得残留");
}
