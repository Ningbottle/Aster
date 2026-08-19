import { describe, expect, it } from "vitest";
import { messagesFromNative, reducePiEvent } from "./sessionReducer";

describe("reducePiEvent", () => {
  it("ignores an event from a previous runtime instance", () => {
    const state = { runtimeInstanceId: 9, messages: [], streamingText: "" };
    const next = reducePiEvent(state, {
      runtimeInstanceId: 8,
      sessionId: "old",
      eventType: "message_update",
      summary: "old delta",
      raw: {},
    });
    expect(next).toBe(state);
  });

  it("preserves restored messages while appending the active stream", () => {
    const state = {
      runtimeInstanceId: 9,
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
