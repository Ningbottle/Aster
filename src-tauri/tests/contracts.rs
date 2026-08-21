//! 前后端 Serde 反序列化与序列化契约测试（Contract Tests）。
//!
//! 前端 invoke 参数与 Rust command DTO 的契约测试：
//! - 为每个 invoke 参数结构与返回值建立契约测试（读取真实前端生成的 fixture 文件进行 serde round-trip）；
//! - 验证字段命名别名（如 host vs host_id, scope vs scope_kind）、默认值缺省处理、
//!   枚举 snake_case 命名以及路径安全解析。

use aster_lib::ipc::pi::{
    PiActiveSessionDto, PiEventEnvelopeDto, PiProjectNodeDto, PiSessionArchiveArgs,
    PiSessionCreateArgs, PiSessionIndexRemoveArgs, PiSessionOpenArgs, PiSessionPromptArgs,
    PiSessionSetModelArgs, PiSessionSetNameArgs, PiSessionSetThinkingArgs, PiSessionSummaryDto,
    PERMISSION_SUMMARY,
};
use aster_lib::pi::runtime::PiRuntimeSnapshotDto;
use aster_lib::skills::{
    self as skill_flow, BatchDeployResult, DeploymentPlanItem, DeploymentTarget, PlanItemStatus,
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
    let min_target: DeploymentTarget =
        serde_json::from_value(min_val.clone()).expect("DeploymentTarget_minimal 应当反序列化成功");
    assert_eq!(min_target.host, "cursor");
    assert_eq!(min_target.scope, "project");
}

#[test]
fn contract_invoke_arg_payloads() {
    let fixtures = load_fixtures();

    // skills_scan_repo 参数
    let scan_args: SkillScanRepoArgs =
        serde_json::from_value(fixtures["SkillScanRepoArgs"].clone())
            .expect("SkillScanRepoArgs 应当反序列化成功");
    assert_eq!(
        scan_args.repo_path,
        Some(PathBuf::from(r"C:\Aster\staging\repo"))
    );
    assert_eq!(scan_args.repo_name, Some("anthropics/skills".into()));

    // skill_get_diff 参数
    let diff_args: SkillGetDiffArgs = serde_json::from_value(fixtures["SkillGetDiffArgs"].clone())
        .expect("SkillGetDiffArgs 应当反序列化成功");
    assert_eq!(diff_args.base_snapshot_id, "snap-v1");
    assert_eq!(diff_args.head_snapshot_id, "snap-v2");

    // skill_get_translation 参数
    let trans_args: SkillGetTranslationArgs =
        serde_json::from_value(fixtures["SkillGetTranslationArgs"].clone())
            .expect("SkillGetTranslationArgs 应当反序列化成功");
    assert_eq!(trans_args.skill_name, "doc-coauthoring");
    assert_eq!(
        trans_args.current_snapshot_id,
        Some("snap-00756142ab04".into())
    );

    // skill_batch_deploy_plan 参数
    let plan_args: SkillBatchDeployPlanArgs =
        serde_json::from_value(fixtures["SkillBatchDeployPlanArgs"].clone())
            .expect("SkillBatchDeployPlanArgs 应当反序列化成功");
    assert_eq!(plan_args.snapshot_id, "snap-00756142ab04");
    assert_eq!(plan_args.targets.len(), 2);
    assert_eq!(plan_args.targets[0].host, "pi");
    assert_eq!(plan_args.targets[0].host_version, "0.84.2");

    // skill_batch_deploy_apply 参数
    let apply_args: SkillBatchDeployApplyArgs =
        serde_json::from_value(fixtures["SkillBatchDeployApplyArgs"].clone())
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
    assert_eq!(
        dto.previous_snapshot_id,
        Some("snap-000000000000-doc-writer".into())
    );

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
    let item: DeploymentPlanItem =
        serde_json::from_value(fixtures["DeploymentPlanItem_sample"].clone())
            .expect("DeploymentPlanItem 应当反序列化成功");
    assert_eq!(item.host_id, "pi");
    assert_eq!(
        item.host_version, "0.84.2",
        "DeploymentPlanItem 应正确包含 host_version"
    );
    assert_eq!(item.status, PlanItemStatus::Ready);
}

#[test]
fn contract_batch_deploy_result_and_snapshot_diff() {
    let fixtures = load_fixtures();

    let res: BatchDeployResult =
        serde_json::from_value(fixtures["BatchDeployResult_sample"].clone())
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
    assert!(
        resolved[0].path.as_os_str().is_empty(),
        "空 scope 应当保持空路径以被 plan 拦截"
    );

    // 2. 不存在的 host/scope 不应生成虚构路径
    let unknown_target = vec![DeploymentTarget {
        host: "non-existent-host".into(),
        host_version: "1.0.0".into(),
        scope: "user".into(),
        path: PathBuf::new(),
    }];
    let resolved_unknown =
        skill_flow::resolve_deployment_targets(&unknown_target, "test-skill", None);
    assert!(
        resolved_unknown[0].path.as_os_str().is_empty(),
        "未安装/不存在的宿主不应生成虚构路径"
    );
}

#[derive(Debug, Deserialize)]
struct ProjectPathArgs {
    path: String,
}

#[derive(Debug, Deserialize)]
struct HostWorkdirSetArgs {
    host: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct HostWorkdirGetArgs {
    host: String,
}

#[derive(Debug, Deserialize)]
struct SkillsScanGithubArgs {
    repo: String,
    #[serde(rename = "gitRef")]
    git_ref: Option<String>,
    #[serde(rename = "skillPath")]
    skill_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubDeviceStartArgs {
    #[serde(rename = "clientId")]
    client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubDevicePollArgs {
    #[serde(rename = "clientId")]
    client_id: String,
    #[serde(rename = "deviceCode")]
    device_code: String,
}

#[derive(Debug, Deserialize)]
struct GithubSetPatArgs {
    pat: String,
}

#[derive(Debug, Deserialize)]
struct SkillQuarantineDeleteArgs {
    #[serde(rename = "quarantineId")]
    quarantine_id: String,
}

#[test]
fn contract_r3_project_and_host_workdir_fixtures() {
    let fixtures = load_fixtures();

    let proj_args: ProjectPathArgs = serde_json::from_value(fixtures["ProjectChooseArgs"].clone())
        .expect("ProjectChooseArgs 应当反序列化成功");
    assert_eq!(proj_args.path, r"C:\Workspace\my-project");

    let set_args: HostWorkdirSetArgs =
        serde_json::from_value(fixtures["HostWorkdirSetArgs"].clone())
            .expect("HostWorkdirSetArgs 应当反序列化成功");
    assert_eq!(set_args.host, "pi");
    assert_eq!(set_args.path, r"C:\Workspace\my-project\pi");

    let get_args: HostWorkdirGetArgs =
        serde_json::from_value(fixtures["HostWorkdirGetArgs"].clone())
            .expect("HostWorkdirGetArgs 应当反序列化成功");
    assert_eq!(get_args.host, "pi");

    let recent: aster_lib::RecentProjectDto =
        serde_json::from_value(fixtures["RecentProject_sample"].clone())
            .expect("RecentProject 应当反序列化成功");
    assert_eq!(recent.display_name, "my-project");
    assert_eq!(recent.is_active, true);
}

#[test]
fn contract_r3_github_and_quarantine_fixtures() {
    let fixtures = load_fixtures();

    let scan_gh: SkillsScanGithubArgs =
        serde_json::from_value(fixtures["SkillsScanGithubArgs"].clone())
            .expect("SkillsScanGithubArgs 应当反序列化成功");
    assert_eq!(scan_gh.repo, "anthropics/skills");
    assert_eq!(scan_gh.git_ref, Some("HEAD".into()));
    assert_eq!(scan_gh.skill_path, Some("skills".into()));

    let dev_start: GithubDeviceStartArgs =
        serde_json::from_value(fixtures["GithubDeviceStartArgs"].clone())
            .expect("GithubDeviceStartArgs 应当反序列化成功");
    assert_eq!(dev_start.client_id, Some("Ov23liAsterDesktop".into()));

    let dev_poll: GithubDevicePollArgs =
        serde_json::from_value(fixtures["GithubDevicePollArgs"].clone())
            .expect("GithubDevicePollArgs 应当反序列化成功");
    assert_eq!(dev_poll.client_id, "Ov23liAsterDesktop");
    assert_eq!(dev_poll.device_code, "sample-device-code");

    let set_pat: GithubSetPatArgs = serde_json::from_value(fixtures["GithubSetPatArgs"].clone())
        .expect("GithubSetPatArgs 应当反序列化成功");
    assert_eq!(set_pat.pat, "ghp_mock_token_for_contract_test_12345");

    let q_del: SkillQuarantineDeleteArgs =
        serde_json::from_value(fixtures["SkillQuarantineDeleteArgs"].clone())
            .expect("SkillQuarantineDeleteArgs 应当反序列化成功");
    assert_eq!(q_del.quarantine_id, "quarantine-snap-mock");

    let dev_resp: aster_lib::DeviceCodeResponse =
        serde_json::from_value(fixtures["DeviceCodeResponse_sample"].clone())
            .expect("DeviceCodeResponse 应当反序列化成功");
    assert_eq!(dev_resp.user_code, "ABCD-1234");
    assert_eq!(dev_resp.interval, 5);

    let dev_poll_res: aster_lib::DevicePollResult =
        serde_json::from_value(fixtures["DevicePollResult_sample"].clone())
            .expect("DevicePollResult 应当反序列化成功");
    assert_eq!(dev_poll_res.status, "success");

    let auth_status: aster_lib::GithubAuthStatus =
        serde_json::from_value(fixtures["GithubAuthStatus_sample"].clone())
            .expect("GithubAuthStatus 应当反序列化成功");
    assert_eq!(auth_status.has_token, true);

    let q_item: aster_lib::skills::QuarantineItemDto =
        serde_json::from_value(fixtures["QuarantineItem_sample"].clone())
            .expect("QuarantineItemDto 应当反序列化成功");
    assert_eq!(q_item.quarantine_id, "quarantine-test");
    assert_eq!(q_item.findings.len(), 1);
}

#[test]
fn contract_pi_session_command_payloads_are_camel_case() {
    let fixtures = load_fixtures();

    let create: PiSessionCreateArgs =
        serde_json::from_value(fixtures["PiSessionCreateArgs"].clone()).unwrap();
    assert_eq!(create.project_path, r"C:\Workspace\project-a");

    let open: PiSessionOpenArgs =
        serde_json::from_value(fixtures["PiSessionOpenArgs"].clone()).unwrap();
    assert_eq!(open.project_path, r"C:\Workspace\project-a");
    assert_eq!(open.session_id, "session-1");

    let name: PiSessionSetNameArgs =
        serde_json::from_value(fixtures["PiSessionSetNameArgs"].clone()).unwrap();
    assert_eq!(name.name, "Refactor settings");

    let model: PiSessionSetModelArgs =
        serde_json::from_value(fixtures["PiSessionSetModelArgs"].clone()).unwrap();
    assert_eq!(model.provider, "fixture");
    assert_eq!(model.model_id, "fixture-model");

    let thinking: PiSessionSetThinkingArgs =
        serde_json::from_value(fixtures["PiSessionSetThinkingArgs"].clone()).unwrap();
    assert_eq!(thinking.level, "medium");

    let prompt: PiSessionPromptArgs =
        serde_json::from_value(fixtures["PiSessionPromptArgs"].clone()).unwrap();
    assert_eq!(prompt.message, "fixture prompt");

    let forget: PiSessionIndexRemoveArgs =
        serde_json::from_value(fixtures["PiSessionIndexRemoveArgs"].clone()).unwrap();
    assert_eq!(forget.session_id, "session-1");

    let archive: PiSessionArchiveArgs =
        serde_json::from_value(fixtures["PiSessionArchiveArgs"].clone()).unwrap();
    assert_eq!(archive.session_id, "session-1");
    assert_eq!(archive.archived, true);

    let snap: PiRuntimeSnapshotDto =
        serde_json::from_value(fixtures["PiRuntimeSnapshotDto_sample"].clone()).unwrap();
    assert_eq!(snap.lifecycle, "ready");
    assert_eq!(snap.has_locked_install, true);
    assert_eq!(snap.session_id.as_deref(), Some("session-1"));

    let active: PiActiveSessionDto =
        serde_json::from_value(fixtures["PiActiveSessionDto_sample"].clone()).unwrap();
    assert_eq!(active.runtime_instance_id, 1);
    assert_eq!(active.session_id, "session-1");
    assert_eq!(active.permission_summary, PERMISSION_SUMMARY);
    assert!(serde_json::to_value(&active)
        .unwrap()
        .get("sessionFile")
        .is_none());

    let node: PiProjectNodeDto =
        serde_json::from_value(fixtures["PiProjectNodeDto_sample"].clone()).unwrap();
    assert_eq!(node.sessions.len(), 1);
    let summary: PiSessionSummaryDto = node.sessions[0].clone();
    assert!(summary.is_active);

    let envelope: PiEventEnvelopeDto =
        serde_json::from_value(fixtures["PiEventEnvelopeDto_sample"].clone()).unwrap();
    assert_eq!(envelope.runtime_instance_id, 9);
    assert_eq!(envelope.event_type, "message_update");
}

#[test]
fn contract_frontend_may_not_select_session_by_session_file() {
    let err = serde_json::from_value::<PiSessionOpenArgs>(serde_json::json!({
        "projectPath": r"C:\Workspace\project-a",
        "sessionId": "session-1",
        "sessionFile": r"C:\fixture\sessions\session-1.jsonl"
    }))
    .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("sessionFile") || msg.contains("unknown field"),
        "open args must reject sessionFile, got {msg}"
    );
}
