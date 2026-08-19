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

export type PiRuntimeSnapshot = {
  lifecycle: string;
  hasLockedInstall: boolean;
  projectPath: string | null;
  sessionId: string | null;
  runtimeInstanceId: number | null;
};

export type RecentProject = {
  path: string;
  display_name: string;
  last_opened_at: string;
  is_active: boolean;
};
