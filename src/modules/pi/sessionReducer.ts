import type { PiEventEnvelope, PiMessage } from "../../types";

export type LiveToolStatus = "running" | "done";

export type LiveTool = {
  id: string;
  name: string;
  args: string;
  result: string;
  isError: boolean;
  status: LiveToolStatus;
};

export type PiConversationState = {
  runtimeInstanceId: number;
  sessionId: string;
  messages: PiMessage[];
  streamingText: string;
  streamingThinking: string;
  liveTools: LiveTool[];
};

export type ContextUsageView =
  | { kind: "unknown" }
  | { kind: "percent"; percent: number }
  | { kind: "tokens"; tokens: number; windowSize: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function messagesFromNative(raw: unknown[]): PiMessage[] {
  const out: PiMessage[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const role = rec.role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult" && role !== "system") {
      continue;
    }
    const timestamp = typeof rec.timestamp === "number" ? rec.timestamp : undefined;
    out.push({ role, content: rec.content, timestamp });
  }
  return out;
}

export function assistantTextFromContent(content: unknown): string {
  return blocksOfType(content, "text", "text");
}

export function thinkingFromContent(content: unknown): string {
  return blocksOfType(content, "thinking", "thinking");
}

export function contextUsageView(usage: Record<string, unknown> | null | undefined): ContextUsageView {
  if (!usage) return { kind: "unknown" };
  const percent = usage.percent;
  const tokens = usage.tokens;
  const windowSize = usage.contextWindow;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    return { kind: "percent", percent };
  }
  if (
    typeof tokens === "number" &&
    Number.isFinite(tokens) &&
    typeof windowSize === "number" &&
    Number.isFinite(windowSize)
  ) {
    return { kind: "tokens", tokens, windowSize };
  }
  return { kind: "unknown" };
}

function blocksOfType(content: unknown, type: string, field: string): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const rec = asRecord(block);
      if (!rec || rec.type !== type) return "";
      const value = rec[field];
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function toolPayloadText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  if (rec && Array.isArray(rec.content)) {
    const text = rec.content
      .map((block) => {
        const item = asRecord(block);
        if (item?.type === "text" && typeof item.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("");
    if (text) return text;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function upsertLiveTool(tools: LiveTool[], next: LiveTool): LiveTool[] {
  const index = tools.findIndex((tool) => tool.id === next.id);
  if (index < 0) return [...tools, next];
  const copy = tools.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export function reducePiEvent(
  state: PiConversationState,
  event: PiEventEnvelope,
): PiConversationState {
  if (event.runtimeInstanceId !== state.runtimeInstanceId) {
    return state;
  }
  if (event.sessionId && event.sessionId !== state.sessionId) {
    return state;
  }
  if (event.eventType === "agent_start") {
    return { ...state, streamingText: "", streamingThinking: "", liveTools: [] };
  }
  if (event.eventType === "message_update") {
    const assistant = asRecord(event.raw.assistantMessageEvent);
    if (assistant?.type === "text_delta" && typeof assistant.delta === "string") {
      return { ...state, streamingText: state.streamingText + assistant.delta };
    }
    if (assistant?.type === "thinking_delta" && typeof assistant.delta === "string") {
      return { ...state, streamingThinking: state.streamingThinking + assistant.delta };
    }
    return state;
  }
  if (event.eventType === "tool_execution_start") {
    const id = typeof event.raw.toolCallId === "string" ? event.raw.toolCallId : "";
    if (!id) return state;
    const name = typeof event.raw.toolName === "string" ? event.raw.toolName : "tool";
    return {
      ...state,
      liveTools: upsertLiveTool(state.liveTools, {
        id,
        name,
        args: toolPayloadText(event.raw.args ?? {}),
        result: "",
        isError: false,
        status: "running",
      }),
    };
  }
  if (event.eventType === "tool_execution_update") {
    const id = typeof event.raw.toolCallId === "string" ? event.raw.toolCallId : "";
    if (!id) return state;
    const existing = state.liveTools.find((tool) => tool.id === id);
    const name =
      typeof event.raw.toolName === "string"
        ? event.raw.toolName
        : existing?.name ?? "tool";
    return {
      ...state,
      liveTools: upsertLiveTool(state.liveTools, {
        id,
        name,
        args: toolPayloadText(event.raw.args ?? existing?.args ?? {}),
        result: toolPayloadText(event.raw.partialResult),
        isError: false,
        status: "running",
      }),
    };
  }
  if (event.eventType === "tool_execution_end") {
    const id = typeof event.raw.toolCallId === "string" ? event.raw.toolCallId : "";
    if (!id) return state;
    const existing = state.liveTools.find((tool) => tool.id === id);
    const name =
      typeof event.raw.toolName === "string"
        ? event.raw.toolName
        : existing?.name ?? "tool";
    return {
      ...state,
      liveTools: upsertLiveTool(state.liveTools, {
        id,
        name,
        args: existing?.args ?? "",
        result: toolPayloadText(event.raw.result),
        isError: event.raw.isError === true,
        status: "done",
      }),
    };
  }
  if (event.eventType === "agent_end" || event.eventType === "agent_settled") {
    return { ...state, streamingText: "", streamingThinking: "", liveTools: [] };
  }
  if (event.eventType === "aster_process_exited") {
    return state;
  }
  return state;
}

export function rollbackOptimisticUser(messages: PiMessage[], text: string): PiMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last?.role === "user" && last.content === text) {
    return messages.slice(0, -1);
  }
  return messages;
}

export type BindingKey = {
  runtimeInstanceId: number;
  sessionId: string;
  messageCount: number;
};

export function snapshotMatchesBinding(
  current: BindingKey | null,
  captured: BindingKey,
  incoming: BindingKey,
): boolean {
  if (!current) return false;
  if (current.runtimeInstanceId !== captured.runtimeInstanceId) return false;
  if (current.sessionId !== captured.sessionId) return false;
  if (incoming.runtimeInstanceId !== captured.runtimeInstanceId) return false;
  if (incoming.sessionId !== captured.sessionId) return false;
  if (current.messageCount > captured.messageCount) return false;
  if (incoming.messageCount < current.messageCount) return false;
  return true;
}

export function isIgnorableResyncError(err: unknown): boolean {
  const message =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
  return /no active Pi session/i.test(message);
}
