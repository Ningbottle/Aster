import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../src-tauri/tests/fixtures");

if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// 定义前端向后端 invoke 发送的全部命令 payload 契约样本
const contractSamples = {
  DeploymentTarget_standard: {
    host: "pi",
    host_version: "0.84.2",
    scope: "user",
    path: "C:\\Users\\test\\.pi\\skills\\doc-coauthoring",
  },
  DeploymentTarget_with_aliases: {
    host_id: "dsh",
    scope_kind: "user",
    path: "",
  },
  DeploymentTarget_minimal: {
    host: "cursor",
    scope: "project",
  },
  TranslationDoc_sample: {
    skill_name: "doc-coauthoring",
    snapshot_id: "snap-00756142ab04",
    purpose: "文档协作技能",
    applicable_tasks: "技术文档撰写与维护",
    target_tools: ["Pi", "Cursor", "Antigravity"],
    prerequisites: "无特殊依赖",
    risks: "标准权限",
    author: "workbench",
    updated_at: "2026-08-18T10:00:00Z",
    markdown_body: "# doc-coauthoring · 中文说明\n\n正文内容",
    is_stale: false,
  },
  SkillItemDto_sample: {
    id: "snap-00756142ab04-doc-writer",
    skill_name: "doc-writer",
    desc: "文档写作工具",
    tools: ["Pi", "Cursor"],
    updated: "2026-08-18T10:00:00Z",
    original: "# doc-writer\n\nOriginal instructions.",
    zh: "# doc-writer · 中文说明",
    snapshot_id: "snap-00756142ab04-doc-writer",
    previous_snapshot_id: "snap-000000000000-doc-writer",
    file_count: 3,
    content_sha: "abcdef0123456789",
  },
  SkillScanRepoArgs: {
    repoPath: "C:\\Aster\\staging\\repo",
    repoName: "anthropics/skills",
  },
  SkillGetDiffArgs: {
    baseSnapshotId: "snap-v1",
    headSnapshotId: "snap-v2",
  },
  SkillGetTranslationArgs: {
    skillName: "doc-coauthoring",
    currentSnapshotId: "snap-00756142ab04",
  },
  SkillBatchDeployPlanArgs: {
    snapshotId: "snap-00756142ab04",
    targets: [
      {
        host: "pi",
        host_version: "0.84.2",
        scope: "user",
        path: "",
      },
      {
        host: "cursor",
        host_version: "1.0.0",
        scope: "user",
        path: "",
      },
    ],
  },
  SkillBatchDeployApplyArgs: {
    snapshotId: "snap-00756142ab04",
    targets: [
      {
        host: "pi",
        host_version: "0.84.2",
        scope: "user",
        path: "C:\\Users\\test\\.pi\\skills\\doc-coauthoring",
      },
    ],
  },
  PiSetModelArgs: {
    modelId: "claude-3-5-sonnet-20241022",
  },
  PiPromptArgs: {
    prompt: "Hello Pi, please summarize our current tasks.",
  },
  PiSessionCreateArgs: {
    projectPath: "C:\\Workspace\\project-a",
  },
  PiSessionOpenArgs: {
    projectPath: "C:\\Workspace\\project-a",
    sessionId: "session-1",
  },
  PiSessionSetNameArgs: {
    name: "Refactor settings",
  },
  PiSessionSetModelArgs: {
    provider: "fixture",
    modelId: "fixture-model",
  },
  PiSessionSetThinkingArgs: {
    level: "medium",
  },
  PiSessionPromptArgs: {
    message: "fixture prompt",
  },
  PiSessionIndexRemoveArgs: {
    sessionId: "session-1",
  },
  PiActiveSessionDto_sample: {
    runtimeInstanceId: 1,
    projectPath: "C:\\Workspace\\project-a",
    projectDisplayName: "project-a",
    sessionId: "session-1",
    sessionName: "Fixture session",
    model: { id: "fixture-model", name: "Fixture Model", provider: "fixture" },
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    messageCount: 2,
    contextUsage: { tokens: 20, contextWindow: 1000, percent: 2 },
    permissionSummary: "windows_user",
    messages: [{ role: "user", content: "fixture user message" }],
  },
  PiProjectNodeDto_sample: {
    path: "C:\\Workspace\\project-a",
    displayName: "project-a",
    sessions: [
      {
        sessionId: "session-1",
        name: "Fixture session",
        createdAt: "2026-08-19T00:00:00Z",
        modifiedAt: "2026-08-19T00:00:00Z",
        messageCount: 2,
        availability: "available",
        isActive: true,
      },
    ],
  },
  PiEventEnvelopeDto_sample: {
    runtimeInstanceId: 9,
    sessionId: "session-1",
    eventType: "message_update",
    summary: "text: hello",
    raw: { assistantMessageEvent: { type: "text_delta", delta: "hello" } },
  },
  DshStartArgs: {
    host: "127.0.0.1",
    port: 38472,
  },
  DeploymentPlanItem_sample: {
    host_id: "pi",
    host_version: "0.84.2",
    host_display_name: "Pi",
    scope_kind: "user",
    target_path: "C:\\Users\\test\\.pi\\skills\\doc-coauthoring",
    status: "ready",
    reason: null,
  },
  BatchDeployResult_sample: {
    success: true,
    deployed_count: 1,
    rolled_back_count: 0,
    results: [
      {
        host_id: "pi",
        target_path: "C:\\Users\\test\\.pi\\skills\\doc-coauthoring",
        deployment_id: 42,
        success: true,
        error: null,
      },
    ],
    error: null,
  },
  SnapshotDiff_sample: {
    base_snapshot_id: "snap-v1",
    head_snapshot_id: "snap-v2",
    added_files: ["extra.md"],
    deleted_files: ["old.txt"],
    modified_files: ["SKILL.md"],
    identical_files: ["LICENSE"],
    file_diffs: [
      {
        path: "SKILL.md",
        status: "modified",
        diff_lines: ["- old line", "+ new line"],
      },
    ],
  },
};

const targetFile = path.join(fixturesDir, "contract_samples.json");
fs.writeFileSync(targetFile, JSON.stringify(contractSamples, null, 2), "utf8");
console.log(`[OK] Generated ${Object.keys(contractSamples).length} contract fixtures at: ${targetFile}`);
