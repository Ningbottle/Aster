import type { PiEventEnvelope, PiMessage } from "../../types";

export type PiConversationState = {
  runtimeInstanceId: number;
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
    const text = state.streamingText;
    if (!text) {
      return { ...state, streamingText: "" };
    }
    return {
      ...state,
      streamingText: "",
      messages: [...state.messages, { role: "assistant", content: text }],
    };
  }
  return state;
}
