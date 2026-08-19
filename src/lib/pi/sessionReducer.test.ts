import { describe, expect, it } from "vitest";
import { messagesFromNative, reducePiEvent } from "./sessionReducer";

describe("reducePiEvent", () => {
  it("ignores an event from a previous runtime instance", () => {
    const state = { runtimeInstanceId: 9, sessionId: "active", messages: [], streamingText: "" };
    const next = reducePiEvent(state, {
      runtimeInstanceId: 8,
      sessionId: "old",
      eventType: "message_update",
      summary: "old delta",
      raw: {},
    });
    expect(next).toBe(state);
  });

  it("ignores an event from a previous native session on the same instance", () => {
    const state = { runtimeInstanceId: 9, sessionId: "s-2", messages: [], streamingText: "" };
    const next = reducePiEvent(state, {
      runtimeInstanceId: 9,
      sessionId: "s-1",
      eventType: "message_update",
      summary: "",
      raw: { assistantMessageEvent: { type: "text_delta", delta: "stale" } },
    });
    expect(next).toBe(state);
  });

  it("preserves restored messages while appending the active stream", () => {
    const state = {
      runtimeInstanceId: 9,
      sessionId: "active",
      messages: [{ role: "user" as const, content: "restored" }],
      streamingText: "",
    };
    const next = reducePiEvent(state, {
      runtimeInstanceId: 9,
      sessionId: "active",
      eventType: "message_update",
      summary: "",
      raw: { assistantMessageEvent: { type: "text_delta", delta: "hello" } },
    });
    expect(next.messages).toHaveLength(1);
    expect(next.streamingText).toBe("hello");
  });

  it("does not invent an assistant row on settle", () => {
    const state = {
      runtimeInstanceId: 9,
      sessionId: "active",
      messages: [{ role: "user" as const, content: "restored" }],
      streamingText: "partial",
    };
    const next = reducePiEvent(state, {
      runtimeInstanceId: 9,
      sessionId: "active",
      eventType: "agent_settled",
      summary: "agent settled",
      raw: {},
    });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.role).toBe("user");
    expect(next.streamingText).toBe("");
  });
});

describe("messagesFromNative", () => {
  it("keeps role and content without inventing text", () => {
    const messages = messagesFromNative([
      { role: "user", content: "fixture user message" },
      { role: "assistant", content: [{ type: "text", text: "fixture assistant message" }] },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
  });
});
