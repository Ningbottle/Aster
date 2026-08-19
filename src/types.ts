// Aster 领域与 UI 共享类型定义

export type AppStatus = {
  app_version: string;
  app_data_dir: string;
  database_schema_version: number;
  evidence_count: number;
};

export type PiRuntime = {
  version: string;
  cli_js: string;
  managed: boolean;
};

export type PiModel = {
  id: string;
  name: string;
  api?: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
};

export type PiSessionState = {
  model?: PiModel;
  thinkingLevel?: string;
  isStreaming?: boolean;
  sessionId?: string;
  messageCount?: number;
};

export type PiSessionSummary = {
  sessionId: string;
  name: string | null;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  availability: "available" | "missing" | "project_missing" | "unsupported";
  isActive: boolean;
};

export type PiProjectNode = {
  path: string;
  displayName: string;
  sessions: PiSessionSummary[];
};

export type PiEventEnvelope = {
  runtimeInstanceId: number;
  sessionId: string | null;
  eventType: string;
  summary: string;
  raw: Record<string, unknown>;
};

export type PiMessage = {
  role: "user" | "assistant" | "toolResult" | "system";
  content: unknown;
  timestamp?: number;
};

export type PiActiveSession = {
  runtimeInstanceId: number;
  projectPath: string;
  projectDisplayName: string;
  sessionId: string;
  sessionName: string | null;
  model: PiModel | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  messageCount: number;
  contextUsage: Record<string, unknown> | null;
  permissionSummary: "windows_user";
  messages: PiMessage[];
};

export type PiEvent = {
  event_type: string;
  summary: string;
  raw?: Record<string, unknown>;
};

export type PiObservation = {
  active: boolean;
  closed: boolean;
  tool_starts: number;
  tool_ends: number;
  tool_names: string[];
  message_updates: number;
  protocol_errors: string[];
};

export type DshRuntime = {
  version: string;
  entry_path: string;
  managed: boolean;
  supported: boolean;
};

export type DshStatus = {
  running: boolean;
  /** 三层探针全部通过（进程存活 + 静态页面 + boot manifest 注入）。 */
  healthy: boolean;
  /** 分层证据：进程存活。 */
  runner_alive: boolean;
  /** 分层证据：HTTP 200 且含 SPA 静态标记。 */
  static_ok: boolean;
  /** 分层证据：响应体含 window.__DSH_BOOT__（前端可启动的必要条件）。 */
  boot_ok: boolean;
  port: number;
  url: string;
  version: string;
  managed: boolean;
  pid: number | null;
  /** Ready/Crashed/Unknown from the live DshSlot, never inferred from a Start click. */
  lifecycle: string;
};

export type PiRuntimeSnapshot = {
  lifecycle: string;
  hasLockedInstall: boolean;
  projectPath: string | null;
  sessionId: string | null;
  runtimeInstanceId: number | null;
};

export type ScopeCandidate = {
  kind: "user" | "project" | "custom";
  path_template: string;
  description: string;
};

export type HostProfile = {
  id: string;
  display_name: string;
  profile_version: string;
  confidence: "verified" | "experimental" | "scan-only";
  discovery_shape: "flat" | "bundle" | "recursive";
  supported_scopes: ScopeCandidate[];
  description: string;
};

export type DiscoveredScope = {
  kind: "user" | "project" | "custom";
  path_template: string;
  resolved_path: string;
  exists: boolean;
  skills_count: number;
};

export type DiscoveredHost = {
  profile: HostProfile;
  installed: boolean;
  discovered_scopes: DiscoveredScope[];
  status: string;
};

export type DiscoveredSkillSummary = {
  name: string;
  relative_path: string;
  description: string | null;
  file_count: number;
  content_sha: string;
  snapshot_id: string;
  has_translation: boolean;
};

export type SkillRepoGroup = {
  repo_name: string;
  source_type: string;
  commit_or_version: string;
  root_path: string;
  skills: DiscoveredSkillSummary[];
};

export type TranslationDoc = {
  skill_name: string;
  snapshot_id: string;
  purpose: string;
  applicable_tasks: string;
  target_tools: string[];
  prerequisites: string;
  risks: string;
  author: string;
  updated_at: string;
  markdown_body: string;
  is_stale: boolean;
};

export type SkillItem = {
  id: string; // 唯一快照 ID
  skill_name?: string; // 技能名称
  desc: string;
  tools: string[];
  updated: string;
  flow?: string[];
  original: string;
  zh: string;
  snapshot_id: string;
  previous_snapshot_id?: string | null;
  file_count?: number;
  content_sha?: string;
};

export type DeploymentTarget = {
  host: string;
  host_version?: string;
  scope: string;
  path?: string;
};

export type FileDiffDetail = {
  path: string;
  status: string;
  diff_lines: string[];
};

export type SnapshotDiff = {
  base_snapshot_id: string;
  head_snapshot_id: string;
  added_files: string[];
  deleted_files: string[];
  modified_files: string[];
  identical_files: string[];
  file_diffs: FileDiffDetail[];
};

export type DeploymentPlanItem = {
  host_id: string;
  host_version?: string;
  host_display_name: string;
  scope_kind: string;
  target_path: string;
  status: "ready" | "already_deployed_by_aster" | "blocked_unmanaged_conflict" | "parent_not_found";
  reason: string | null;
};

export type DeploymentPlan = {
  snapshot_id: string;
  skill_name: string;
  items: DeploymentPlanItem[];
  can_apply: boolean;
  total_targets: number;
  ready_targets: number;
  blocked_targets: number;
};

export type BatchDeployItemResult = {
  host_id: string;
  target_path: string;
  deployment_id: number | null;
  success: boolean;
  error: string | null;
};

export type BatchDeployResult = {
  success: boolean;
  deployed_count: number;
  rolled_back_count: number;
  results: BatchDeployItemResult[];
  error: string | null;
};

export type ServiceTab = {
  id: "pi" | "dsh" | "skills";
  label: string;
  icon: string;
};

export type ViewId = "home" | "pi" | "dsh" | "skills" | "agents" | "infra";

export type RecentProject = {
  path: string;
  display_name: string;
  last_opened_at: string;
  is_active: boolean;
};

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type DevicePollResult = {
  status: "success" | "pending" | "slow_down" | "expired" | "denied" | "error" | "unknown";
  error: string | null;
};

export type GithubAuthStatus = {
  has_token: boolean;
  source: string;
};

export type StaticCheckFinding = {
  relative_path: string;
  finding_type: string;
  problem: string;
  line_number?: number | null;
};

export type QuarantineItem = {
  id: number;
  quarantine_id: string;
  source_info: string;
  reason: string;
  quarantined_at: string;
  quarantine_path: string;
  total_findings: number;
  findings: StaticCheckFinding[];
};

