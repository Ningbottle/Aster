import type { PiEventEnvelope, PiMessage } from "../../types";

export type PiConversationState = {
  runtimeInstanceId: number;
  sessionId: string;
  messages: PiMessage[];
  streamingText: string;
};

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
    return { ...state, streamingText: "" };
  }
  if (event.eventType === "message_update") {
    const assistant = asRecord(event.raw.assistantMessageEvent);
    if (assistant?.type === "text_delta" && typeof assistant.delta === "string") {
      return { ...state, streamingText: state.streamingText + assistant.delta };
    }
    return state;
  }
  if (event.eventType === "agent_end" || event.eventType === "agent_settled") {
    return { ...state, streamingText: "" };
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
