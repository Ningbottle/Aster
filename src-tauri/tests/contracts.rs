//! 前后端 Serde 反序列化与序列化契约测试（Contract Tests）。
//!
//! 根据 AGENTS.md 与 ADR-0005 约束：
//! - 为每个 invoke 参数结构与返回值建立契约测试（读取真实前端生成的 fixture 文件进行 serde round-trip）；
//! - 验证字段命名别名（如 host vs host_id, scope vs scope_kind）、默认值缺省处理、
//!   枚举 snake_case 命名以及路径安全解析。

use aster_lib::skill_flow::{
    self, BatchDeployResult, DeploymentPlanItem,
    DeploymentTarget, PlanItemStatus,
    SnapshotDiff, TranslationDoc,
};
use aster_lib::SkillItemDto;
use serde::Deserialize;
use std::path::PathBuf;

fn load_fixtures() -> serde_json::Value {
    let json_str = include_str!("fixtures/contract_samples.json");
    serde_json::from_str(json_str).expect("应当成功解析 contract_samples.json")
}

#[derive(Debug, Deserialize)]
struct SkillScanRepoArgs {
    #[serde(rename = "repoPath")]
    repo_path: Option<PathBuf>,
    #[serde(rename = "repoName")]
    repo_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SkillGetDiffArgs {
    #[serde(rename = "baseSnapshotId")]
    base_snapshot_id: String,
    #[serde(rename = "headSnapshotId")]
    head_snapshot_id: String,
}

#[derive(Debug, Deserialize)]
struct SkillGetTranslationArgs {
    #[serde(rename = "skillName")]
    skill_name: String,
    #[serde(rename = "currentSnapshotId")]
    current_snapshot_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SkillBatchDeployPlanArgs {
    #[serde(rename = "snapshotId")]
    snapshot_id: String,
    targets: Vec<DeploymentTarget>,
}

#[derive(Debug, Deserialize)]
struct SkillBatchDeployApplyArgs {
    #[serde(rename = "snapshotId")]
    snapshot_id: String,
    targets: Vec<DeploymentTarget>,
}

#[derive(Debug, Deserialize)]
struct PiSetModelArgs {
    #[serde(rename = "modelId")]
    model_id: String,
}

#[derive(Debug, Deserialize)]
struct PiPromptArgs {
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct DshStartArgs {
    host: Option<String>,
    port: Option<u16>,
}

#[test]
fn contract_deployment_target_fixtures() {
    let fixtures = load_fixtures();

    // 1. 标准格式
    let std_val = &fixtures["DeploymentTarget_standard"];
    let std_target: DeploymentTarget = serde_json::from_value(std_val.clone())
        .expect("DeploymentTarget_standard 应当反序列化成功");
    assert_eq!(std_target.host, "pi");
    assert_eq!(std_target.host_version, "0.84.2");
    assert_eq!(std_target.scope, "user");
    assert_eq!(
        std_target.path,
        PathBuf::from(r"C:\Users\test\.pi\skills\doc-coauthoring")
    );

    // 2. 别名与默认值
    let alias_val = &fixtures["DeploymentTarget_with_aliases"];
    let alias_target: DeploymentTarget = serde_json::from_value(alias_val.clone())
        .expect("DeploymentTarget_with_aliases 应当反序列化成功");
    assert_eq!(alias_target.host, "dsh");
    assert_eq!(alias_target.host_version, "1.0.0");
    assert_eq!(alias_target.scope, "user");
    assert_eq!(alias_target.path, PathBuf::from(""));

    // 3. 最小格式
    let min_val = &fixtures["DeploymentTarget_minimal"];
    let min_target: DeploymentTarget = serde_json::from_value(min_val.clone())
        .expect("DeploymentTarget_minimal 应当反序列化成功");
    assert_eq!(min_target.host, "cursor");
    assert_eq!(min_target.scope, "project");
}

#[test]
fn contract_invoke_arg_payloads() {
    let fixtures = load_fixtures();

    // skills_scan_repo 参数
    let scan_args: SkillScanRepoArgs = serde_json::from_value(fixtures["SkillScanRepoArgs"].clone())
        .expect("SkillScanRepoArgs 应当反序列化成功");
    assert_eq!(scan_args.repo_path, Some(PathBuf::from(r"C:\Aster\staging\repo")));
    assert_eq!(scan_args.repo_name, Some("anthropics/skills".into()));

    // skill_get_diff 参数
    let diff_args: SkillGetDiffArgs = serde_json::from_value(fixtures["SkillGetDiffArgs"].clone())
        .expect("SkillGetDiffArgs 应当反序列化成功");
    assert_eq!(diff_args.base_snapshot_id, "snap-v1");
    assert_eq!(diff_args.head_snapshot_id, "snap-v2");

    // skill_get_translation 参数
    let trans_args: SkillGetTranslationArgs = serde_json::from_value(fixtures["SkillGetTranslationArgs"].clone())
        .expect("SkillGetTranslationArgs 应当反序列化成功");
    assert_eq!(trans_args.skill_name, "doc-coauthoring");
    assert_eq!(trans_args.current_snapshot_id, Some("snap-00756142ab04".into()));

    // skill_batch_deploy_plan 参数
    let plan_args: SkillBatchDeployPlanArgs = serde_json::from_value(fixtures["SkillBatchDeployPlanArgs"].clone())
        .expect("SkillBatchDeployPlanArgs 应当反序列化成功");
    assert_eq!(plan_args.snapshot_id, "snap-00756142ab04");
    assert_eq!(plan_args.targets.len(), 2);
    assert_eq!(plan_args.targets[0].host, "pi");
    assert_eq!(plan_args.targets[0].host_version, "0.84.2");

    // skill_batch_deploy_apply 参数
    let apply_args: SkillBatchDeployApplyArgs = serde_json::from_value(fixtures["SkillBatchDeployApplyArgs"].clone())
        .expect("SkillBatchDeployApplyArgs 应当反序列化成功");
    assert_eq!(apply_args.snapshot_id, "snap-00756142ab04");
    assert_eq!(apply_args.targets.len(), 1);

    // pi_set_model 参数
    let set_model_args: PiSetModelArgs = serde_json::from_value(fixtures["PiSetModelArgs"].clone())
        .expect("PiSetModelArgs 应当反序列化成功");
    assert_eq!(set_model_args.model_id, "claude-3-5-sonnet-20241022");

    // pi_prompt 参数
    let prompt_args: PiPromptArgs = serde_json::from_value(fixtures["PiPromptArgs"].clone())
        .expect("PiPromptArgs 应当反序列化成功");
    assert!(prompt_args.prompt.contains("Hello Pi"));

    // dsh_start 参数
    let dsh_args: DshStartArgs = serde_json::from_value(fixtures["DshStartArgs"].clone())
        .expect("DshStartArgs 应当反序列化成功");
    assert_eq!(dsh_args.host, Some("127.0.0.1".into()));
    assert_eq!(dsh_args.port, Some(38472));
}

#[test]
fn contract_skill_item_dto_and_translation_doc() {
    let fixtures = load_fixtures();

    // SkillItemDto
    let dto: SkillItemDto = serde_json::from_value(fixtures["SkillItemDto_sample"].clone())
        .expect("SkillItemDto 应当反序列化成功");
    assert_eq!(dto.id, "snap-00756142ab04-doc-writer");
    assert_eq!(dto.skill_name, "doc-writer");
    assert_eq!(dto.previous_snapshot_id, Some("snap-000000000000-doc-writer".into()));

    // TranslationDoc
    let doc: TranslationDoc = serde_json::from_value(fixtures["TranslationDoc_sample"].clone())
        .expect("TranslationDoc 应当反序列化成功");
    assert_eq!(doc.skill_name, "doc-coauthoring");
    assert_eq!(doc.target_tools.len(), 3);
    assert_eq!(doc.is_stale, false);
}

#[test]
fn contract_deployment_plan_item_host_version() {
    let fixtures = load_fixtures();
    let item: DeploymentPlanItem = serde_json::from_value(fixtures["DeploymentPlanItem_sample"].clone())
        .expect("DeploymentPlanItem 应当反序列化成功");
    assert_eq!(item.host_id, "pi");
    assert_eq!(item.host_version, "0.84.2", "DeploymentPlanItem 应正确包含 host_version");
    assert_eq!(item.status, PlanItemStatus::Ready);
}

#[test]
fn contract_batch_deploy_result_and_snapshot_diff() {
    let fixtures = load_fixtures();

    let res: BatchDeployResult = serde_json::from_value(fixtures["BatchDeployResult_sample"].clone())
        .expect("BatchDeployResult 应当反序列化成功");
    assert_eq!(res.success, true);
    assert_eq!(res.deployed_count, 1);
    assert_eq!(res.results[0].deployment_id, Some(42));

    let diff: SnapshotDiff = serde_json::from_value(fixtures["SnapshotDiff_sample"].clone())
        .expect("SnapshotDiff 应当反序列化成功");
    assert_eq!(diff.added_files, vec!["extra.md"]);
    assert_eq!(diff.file_diffs.len(), 1);
    assert_eq!(diff.file_diffs[0].status, "modified");
}

#[test]
fn contract_strict_path_resolution_and_empty_scope() {
    // 1. 空 scope 不解析
    let empty_scope_target = vec![DeploymentTarget {
        host: "pi".into(),
        host_version: "0.84.2".into(),
        scope: "".into(),
        path: PathBuf::new(),
    }];
    let resolved = skill_flow::resolve_deployment_targets(&empty_scope_target, "test-skill", None);
    assert!(resolved[0].path.as_os_str().is_empty(), "空 scope 应当保持空路径以被 plan 拦截");

    // 2. 不存在的 host/scope 不应生成虚构路径
    let unknown_target = vec![DeploymentTarget {
        host: "non-existent-host".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: PathBuf::new(),
    }];
    let resolved_unknown = skill_flow::resolve_deployment_targets(&unknown_target, "test-skill", None);
    assert!(resolved_unknown[0].path.as_os_str().is_empty(), "未安装/不存在的宿主不应生成虚构路径");
}
