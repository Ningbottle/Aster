import { describe, expect, it } from "vitest";
import {
  isIgnorableResyncError,
  messagesFromNative,
  reducePiEvent,
  rollbackOptimisticUser,
  snapshotMatchesBinding,
} from "./sessionReducer";

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

describe("rollbackOptimisticUser", () => {
  it("removes only the last matching optimistic user row", () => {
    const messages = [
      { role: "user" as const, content: "kept" },
      { role: "user" as const, content: "failed" },
    ];
    const next = rollbackOptimisticUser(messages, "failed");
    expect(next).toEqual([{ role: "user", content: "kept" }]);
  });

  it("leaves messages unchanged when the last row is not the failed text", () => {
    const messages = [{ role: "assistant" as const, content: "ok" }];
    expect(rollbackOptimisticUser(messages, "failed")).toBe(messages);
    expect(rollbackOptimisticUser([], "failed")).toEqual([]);
    expect(
      rollbackOptimisticUser([{ role: "user" as const, content: "other" }], "failed"),
    ).toHaveLength(1);
  });
});

describe("snapshotMatchesBinding", () => {
  const key = { runtimeInstanceId: 3, sessionId: "s-1", messageCount: 4 };

  it("applies a same-binding snapshot that is at least as complete", () => {
    expect(snapshotMatchesBinding(key, key, { ...key, messageCount: 6 })).toBe(true);
    expect(snapshotMatchesBinding(key, key, key)).toBe(true);
  });

  it("rejects a snapshot after the UI moved to another session", () => {
    expect(
      snapshotMatchesBinding(
        { runtimeInstanceId: 4, sessionId: "s-2", messageCount: 1 },
        key,
        { ...key, messageCount: 6 },
      ),
    ).toBe(false);
    expect(
      snapshotMatchesBinding(key, key, { runtimeInstanceId: 3, sessionId: "s-other", messageCount: 6 }),
    ).toBe(false);
    expect(snapshotMatchesBinding(null, key, { ...key, messageCount: 6 })).toBe(false);
  });

  it("rejects a snapshot that would wipe a newer local user turn", () => {
    expect(
      snapshotMatchesBinding({ ...key, messageCount: 5 }, key, { ...key, messageCount: 6 }),
    ).toBe(false);
  });

  it("rejects an older incoming snapshot of the same binding", () => {
    expect(
      snapshotMatchesBinding(key, key, { ...key, messageCount: 2 }),
    ).toBe(false);
  });
});

describe("isIgnorableResyncError", () => {
  it("ignores a missing active session after switch", () => {
    expect(isIgnorableResyncError("no active Pi session")).toBe(true);
    expect(isIgnorableResyncError({ message: "RpcFailed: no active Pi session" })).toBe(true);
    expect(isIgnorableResyncError("timed out waiting for response")).toBe(false);
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
