use super::*;
use crate::platform::db;
use chrono::Utc;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

fn setup() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    db::migrate(&mut conn).unwrap();
    conn
}

fn write_skill(root: &Path, name: &str, files: &[(&str, &str)]) {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    for (f, content) in files {
        let p = dir.join(f);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }
}

#[test]
fn multi_skill_repo_scanned_and_grouped() {
    let tmp = tempfile::tempdir().unwrap();
    let repo_root = tmp.path().join("anthropics-skills");
    fs::create_dir_all(&repo_root).unwrap();

    write_skill(
        &repo_root,
        "skills/doc-coauthoring",
        &[(
            "SKILL.md",
            "---\nname: doc-coauthoring\ndescription: Co-author documentation\n---\n# Doc",
        )],
    );
    write_skill(
        &repo_root,
        "skills/code-review",
        &[(
            "SKILL.md",
            "---\nname: code-review\ndescription: Review pull requests\n---\n# Review",
        )],
    );

    let group =
        scan_multi_skill_repo(&repo_root, "anthropics/skills", "main", None, None).unwrap();
    assert_eq!(group.repo_name, "anthropics/skills");
    assert_eq!(group.skills.len(), 2);
    assert!(group.skills.iter().any(|s| s.name == "doc-coauthoring"));
    assert!(group.skills.iter().any(|s| s.name == "code-review"));
    assert!(group
        .skills
        .iter()
        .all(|s| s.snapshot_id.starts_with("main-")));
}

#[test]
fn local_rescan_after_content_change_produces_new_snapshot() {
    // 本地扫描没有 commit 概念：快照版本段必须随内容哈希变化，
    // 否则同名 Skill 重扫永远是同一快照 id，历史链与 Diff 无法形成。
    let tmp = tempfile::tempdir().unwrap();
    let repo_root = tmp.path().join("repo");
    write_skill(&repo_root, "demo-skill", &[("SKILL.md", "# v1")]);
    let g1 = scan_multi_skill_repo(&repo_root, "local-repo", "local", None, Some(tmp.path()))
        .unwrap();
    let id_v1 = g1.skills[0].snapshot_id.clone();

    write_skill(&repo_root, "demo-skill", &[("SKILL.md", "# v2 changed")]);
    let g2 = scan_multi_skill_repo(&repo_root, "local-repo", "local", None, Some(tmp.path()))
        .unwrap();
    let id_v2 = g2.skills[0].snapshot_id.clone();

    assert_ne!(id_v1, id_v2, "内容变化后本地快照 id 必须变化");
    assert!(id_v1.ends_with("-demo-skill") && id_v2.ends_with("-demo-skill"));
    // 内容不变重扫：快照 id 必须稳定（幂等）。
    let g3 = scan_multi_skill_repo(&repo_root, "local-repo", "local", None, Some(tmp.path()))
        .unwrap();
    assert_eq!(g3.skills[0].snapshot_id, id_v2);
}

#[test]
fn resolve_github_ref_passthrough_full_sha_and_rejects_bad_repo() {
    // 40 位十六进制 sha 直接返回（小写化），不触发网络请求。
    let sha = "0123456789abcdef0123456789ABCDEF01234567";
    let got = resolve_github_ref("owner/repo", Some(sha), None).unwrap();
    assert_eq!(got, sha.to_ascii_lowercase());
    // 非法仓库标识（缺少 owner/ 前缀）必须在发网络请求前就报错。
    assert!(resolve_github_ref("noslash", Some("HEAD"), None).is_err());
    assert!(resolve_github_ref("  ", None, None).is_err());
}

#[test]
fn quarantine_isolates_dangerous_files_and_cleans_staging() {
    let tmp = tempfile::tempdir().unwrap();
    let staging = tmp.path().join("staging");
    let quarantine = tmp.path().join("quarantine");
    fs::create_dir_all(&staging).unwrap();
    fs::create_dir_all(&quarantine).unwrap();

    let bad_skill = staging.join("malicious-skill");
    write_skill(
        &staging,
        "malicious-skill",
        &[
            ("SKILL.md", "Dangerous"),
            ("payload.exe", "fake-binary"),
            ("script.bat", "@echo off"),
        ],
    );

    let check_res = static_check(&bad_skill);
    assert!(check_res.is_err(), "静态检查必须拦截可执行/批处理文件");
    let findings = check_res.unwrap_err();

    let q_record =
        quarantine_bad_skill(&quarantine, "bad-author/bad-repo", &bad_skill, &findings)
            .unwrap();
    assert!(Path::new(&q_record.quarantine_path)
        .join("manifest.json")
        .is_file());
    assert!(Path::new(&q_record.quarantine_path)
        .join("content")
        .join("payload.exe")
        .is_file());
    assert!(!bad_skill.exists(), "隔离后 staging 临时目录必须被完全清理");
}

#[test]
fn snapshot_diff_detects_additions_modifications_and_deletions() {
    let tmp = tempfile::tempdir().unwrap();
    let v1_dir = tmp.path().join("v1");
    let v2_dir = tmp.path().join("v2");
    write_skill(
        tmp.path(),
        "v1",
        &[
            ("SKILL.md", "line1\nline2\n"),
            ("removed.txt", "bye"),
            ("same.txt", "identical"),
        ],
    );
    write_skill(
        tmp.path(),
        "v2",
        &[
            ("SKILL.md", "line1\nline2-modified\n"),
            ("added.txt", "hello"),
            ("same.txt", "identical"),
        ],
    );

    let diff = snapshot_diff(&v1_dir, &v2_dir, "v1", "v2").unwrap();
    assert_eq!(diff.added_files, vec!["added.txt"]);
    assert_eq!(diff.deleted_files, vec!["removed.txt"]);
    assert_eq!(diff.modified_files, vec!["SKILL.md"]);
    assert_eq!(diff.identical_files, vec!["same.txt"]);
}

// 回归防护：2026-08-18 审计中 R1 的 Diff 面板曾卡“计算中”（旧 release 二进制，
// 当前代码未复现）。snapshot_diff 是纯文件 I/O，这里锁定两类病态输入的行为：
// 缺失目录不报错、大目录在秒级完成。
#[test]
fn snapshot_diff_handles_missing_dirs_and_large_trees() {
    let tmp = tempfile::tempdir().unwrap();
    let missing_base = tmp.path().join("missing-base");
    let head = tmp.path().join("head");

    let owned: Vec<(String, String)> = (0..500)
        .map(|i| {
            (
                format!("dir{}/file{}.txt", i % 20, i),
                format!("content-{i}"),
            )
        })
        .collect();
    let refs: Vec<(&str, &str)> = owned
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    write_skill(tmp.path(), "head", &refs);

    let started = std::time::Instant::now();
    let diff = snapshot_diff(&missing_base, &head, "missing", "head").unwrap();
    // base 不存在：所有 head 文件计为新增，不得报错。
    assert_eq!(diff.added_files.len(), 500);
    assert!(diff.deleted_files.is_empty());
    assert!(diff.modified_files.is_empty());
    assert!(
        started.elapsed().as_secs() < 10,
        "500 文件的 diff 必须在秒级完成，实测 {:?}",
        started.elapsed()
    );
}

#[test]
fn snapshot_diff_truncates_oversized_line_diffs() {
    let tmp = tempfile::tempdir().unwrap();
    let big_a = (0..2000)
        .map(|i| format!("old-{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let big_b = (0..2000)
        .map(|i| format!("new-{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    write_skill(tmp.path(), "a", &[("big.md", big_a.as_str())]);
    write_skill(tmp.path(), "b", &[("big.md", big_b.as_str())]);

    let diff = snapshot_diff(&tmp.path().join("a"), &tmp.path().join("b"), "a", "b").unwrap();
    let detail = diff.file_diffs.iter().find(|d| d.path == "big.md").unwrap();
    // 超过 1000 行必须截断，防止巨大响应拖垮 UI。
    // 上界 1003：差异分支一次 push 两行，检查在 push 之后，再加截断标记。
    assert!(
        detail.diff_lines.len() <= 1003,
        "diff 必须截断，实际 {} 行",
        detail.diff_lines.len()
    );
    assert!(detail.diff_lines.iter().any(|l| l.contains("truncated")));
}

#[test]
fn translation_lifecycle_and_stale_detection() {
    let tmp = tempfile::tempdir().unwrap();
    let tr_root = tmp.path().join("translations");
    let conn = setup();

    let doc = TranslationDoc {
        skill_name: "doc-coauthoring".into(),
        snapshot_id: "snap-v1".into(),
        purpose: "协助撰写设计文档".into(),
        applicable_tasks: "架构设计与评审".into(),
        target_tools: vec!["pi".into(), "cursor".into()],
        prerequisites: "无凭据需求".into(),
        risks: "纯文档".into(),
        author: "developer".into(),
        updated_at: Utc::now().to_rfc3339(),
        markdown_body: "# 中文使用说明\n本文档由用户编写。".into(),
        is_stale: false,
    };

    save_translation(Some(&conn), &tr_root, &doc).unwrap();

    // 加载相同快照 -> is_stale 为 false
    let loaded = load_translation(&tr_root, "doc-coauthoring", Some("snap-v1"))
        .unwrap()
        .unwrap();
    assert!(!loaded.is_stale);
    assert_eq!(loaded.purpose, "协助撰写设计文档");

    // 当上游升级到新快照 snap-v2 -> 提示 is_stale: true，但用户内容绝不丢失或静默覆盖！
    let stale = load_translation(&tr_root, "doc-coauthoring", Some("snap-v2"))
        .unwrap()
        .unwrap();
    assert!(stale.is_stale, "快照升级必须标记说明已过期");
    assert_eq!(stale.markdown_body, "# 中文使用说明\n本文档由用户编写。");
}

#[test]
fn batch_deployment_plan_and_compensating_rollback() {
    let mut conn = setup();
    let tmp = tempfile::tempdir().unwrap();
    let skills_root = tmp.path().join("skills");
    let managed_root = tmp.path().join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    write_skill(tmp.path(), "my-skill", &[("SKILL.md", "# Skill Content")]);
    let src = SkillSource {
        repo: "org/repo".into(),
        commit_sha: "commit123456789".into(),
        skill_path: "my-skill".into(),
    };
    let snap = create_snapshot(&skills_root, &src, &tmp.path().join("my-skill")).unwrap();
    record_snapshot(&conn, &src, &snap).unwrap();

    // 构造两个合法目标和一个存在外部非托管冲突的目标
    let t1 = DeploymentTarget {
        host: "pi".into(),
        host_version: "0.84.2".into(),
        scope: "user".into(),
        path: managed_root.join("pi-skills").join("my-skill"),
    };
    let t2 = DeploymentTarget {
        host: "cursor".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("cursor-skills").join("my-skill"),
    };

    // 1. 正常规划与批量部署成功
    let plan = plan_batch_deployment(
        &conn,
        &snap,
        &[t1.clone(), t2.clone()],
        std::slice::from_ref(&managed_root),
    );
    assert!(plan.can_apply);
    assert_eq!(plan.ready_targets, 2);

    let res = deploy_batch_planned(
        &mut conn,
        &snap,
        &[t1.clone(), t2.clone()],
        std::slice::from_ref(&managed_root),
    )
    .unwrap();
    assert!(res.success);
    assert_eq!(res.deployed_count, 2);
    assert!(t1.path.join("SKILL.md").is_file());
    assert!(t2.path.join("SKILL.md").is_file());

    // 2. 模拟外部冲突目标：制造一个未托管且包含用户文件的目录
    let foreign_dir = managed_root.join("foreign-skills").join("my-skill");
    fs::create_dir_all(&foreign_dir).unwrap();
    fs::write(
        foreign_dir.join("user-file.txt"),
        "Important unmanaged data",
    )
    .unwrap();

    let t_conflict = DeploymentTarget {
        host: "zed".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: foreign_dir.clone(),
    };

    let conflict_plan = plan_batch_deployment(
        &conn,
        &snap,
        std::slice::from_ref(&t_conflict),
        std::slice::from_ref(&managed_root),
    );
    assert!(!conflict_plan.can_apply, "包含未托管冲突必须阻止应用");
    assert_eq!(conflict_plan.blocked_targets, 1);

    // 3. 补偿回滚测试：部署三个目标，第三个目标在执行时发生错误，验证前两个目标被补偿回滚
    let t3 = DeploymentTarget {
        host: "antigravity".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("antigravity-skills").join("my-skill"),
    };
    let t4 = DeploymentTarget {
        host: "qoder".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: managed_root.join("qoder-skills").join("my-skill"),
    };
    // 在管理根下制造一个阻断父级文件的目标，使 create_dir_all 在运行时失败
    let fail_parent = managed_root.join("blocked-parent");
    fs::write(&fail_parent, "blocking regular file").unwrap();
    let t_fail = DeploymentTarget {
        host: "zed".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: fail_parent.join("my-skill"),
    };

    // 直接调用 deploy_batch_planned 模拟包含执行失败的批处理
    let batch_fail_res = deploy_batch_planned(
        &mut conn,
        &snap,
        &[t3, t4, t_fail],
        std::slice::from_ref(&managed_root),
    )
    .unwrap();
    assert!(!batch_fail_res.success);
    assert_eq!(batch_fail_res.deployed_count, 0);
    assert_eq!(batch_fail_res.rolled_back_count, 2);
    // 4. 外部修改保护测试：部署后的目录若被外部篡改，重新部署或规划必须拒绝覆盖
    fs::write(t1.path.join("tampered.txt"), "external user edit").unwrap();
    let tampered_plan = plan_batch_deployment(
        &conn,
        &snap,
        std::slice::from_ref(&t1),
        std::slice::from_ref(&managed_root),
    );
    assert!(
        !tampered_plan.can_apply,
        "被外部修改的托管目录必须阻止自动覆盖"
    );
    assert_eq!(tampered_plan.blocked_targets, 1);

    let direct_deploy_err = deploy(&conn, &snap, &t1, &managed_root).unwrap_err();
    assert!(
        direct_deploy_err.contains("was modified externally"),
        "deploy 必须明确拒绝覆盖被外部修改的目录"
    );
}

#[test]
fn rollback_refuses_externally_modified_target() {
    // 回滚是整目录删除，与部署一样必须遵守“外部修改即停止自动操作”的不变量。
    let mut conn = setup();
    let tmp = tempfile::tempdir().unwrap();
    let skills_root = tmp.path().join("skills");
    let managed_root = tmp.path().join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    write_skill(tmp.path(), "my-skill", &[("SKILL.md", "# Skill Content")]);
    let src = SkillSource {
        repo: "org/repo".into(),
        commit_sha: "commit123456789".into(),
        skill_path: "my-skill".into(),
    };
    let snap = create_snapshot(&skills_root, &src, &tmp.path().join("my-skill")).unwrap();
    record_snapshot(&conn, &src, &snap).unwrap();

    let t = DeploymentTarget {
        host: "pi".into(),
        host_version: "0.84.2".into(),
        scope: "user".into(),
        path: managed_root.join("pi-skills").join("my-skill"),
    };
    let res = deploy_batch_planned(
        &mut conn,
        &snap,
        std::slice::from_ref(&t),
        std::slice::from_ref(&managed_root),
    )
    .unwrap();
    assert!(res.success);
    let dep_id: i64 = conn
        .query_row(
            "SELECT id FROM skill_deployment WHERE state = 'deployed' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // 无外部修改：回滚正常删除并标记。
    rollback(&conn, dep_id, &t.path).unwrap();
    assert!(!t.path.exists());

    // 重新部署后模拟外部修改：回滚必须拒绝且目录原样保留。
    let res2 = deploy_batch_planned(
        &mut conn,
        &snap,
        std::slice::from_ref(&t),
        std::slice::from_ref(&managed_root),
    )
    .unwrap();
    assert!(res2.success);
    let dep_id2: i64 = conn
        .query_row(
            "SELECT id FROM skill_deployment WHERE state = 'deployed' ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    fs::write(
        t.path.join("user-notes.txt"),
        "user data written outside Aster",
    )
    .unwrap();

    let err = rollback(&conn, dep_id2, &t.path).unwrap_err();
    assert!(err.contains("external modification"), "got: {err}");
    assert!(
        t.path.join("user-notes.txt").is_file(),
        "外部修改的目录必须原样保留"
    );
    let state: String = conn
        .query_row(
            "SELECT state FROM skill_deployment WHERE id = ?1",
            [dep_id2],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state, "deployed", "被拒绝的回滚不得改动部署状态");
}
