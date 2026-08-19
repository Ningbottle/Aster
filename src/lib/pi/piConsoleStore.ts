import { get, writable } from "svelte/store";
import type { PiActiveSession, PiEventEnvelope, PiMessage, PiModel, PiProjectNode } from "../../types";
import { piApi } from "./api";
import { messagesFromNative, reducePiEvent } from "./sessionReducer";

export type PiTreeStatus = "idle" | "loading" | "ready" | "error";
export type PiSessionStatus =
  | "closed"
  | "starting"
  | "idle"
  | "streaming"
  | "compacting"
  | "error";

export type PiConsoleState = {
  tree: PiProjectNode[];
  active: PiActiveSession | null;
  messages: PiMessage[];
  streamingText: string;
  treeStatus: PiTreeStatus;
  sessionStatus: PiSessionStatus;
  error: string | null;
  availableModels: PiModel[];
  modelsError: string | null;
  busyOffer: { projectPath: string; sessionId: string } | null;
};

const initial: PiConsoleState = {
  tree: [],
  active: null,
  messages: [],
  streamingText: "",
  treeStatus: "idle",
  sessionStatus: "closed",
  error: null,
  availableModels: [],
  modelsError: null,
  busyOffer: null,
};

function statusFromActive(active: PiActiveSession | null): PiSessionStatus {
  if (!active) return "closed";
  if (active.isCompacting) return "compacting";
  if (active.isStreaming) return "streaming";
  return "idle";
}

function applySnapshot(current: PiConsoleState, active: PiActiveSession): PiConsoleState {
  return {
    ...current,
    active,
    messages: messagesFromNative(active.messages as unknown[]),
    streamingText: "",
    sessionStatus: statusFromActive(active),
    error: null,
    busyOffer: null,
  };
}

function toError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function createStore() {
  const { subscribe, update, set } = writable<PiConsoleState>(initial);

  let settleSync: Promise<void> | null = null;

  async function refreshTree(): Promise<void> {
    update((s) => ({ ...s, treeStatus: "loading", error: s.treeStatus === "error" ? s.error : null }));
    try {
      const tree = await piApi.refreshTree();
      update((s) => ({ ...s, tree, treeStatus: "ready" }));
    } catch (err) {
      update((s) => ({ ...s, treeStatus: "error", error: toError(err) }));
    }
  }

  async function loadModels(): Promise<void> {
    try {
      const availableModels = await piApi.availableModels();
      update((s) => ({
        ...s,
        availableModels: Array.isArray(availableModels) ? availableModels : [],
        modelsError: null,
      }));
    } catch (err) {
      update((s) => ({
        ...s,
        availableModels: [],
        modelsError: toError(err),
      }));
    }
  }

  async function createSession(projectPath: string): Promise<void> {
    update((s) => ({ ...s, sessionStatus: "starting", error: null, busyOffer: null }));
    try {
      const active = await piApi.createSession(projectPath);
      update((s) => applySnapshot(s, active));
      await refreshTree();
      await loadModels();
    } catch (err) {
      const message = toError(err);
      if (message === "busy") {
        update((s) => ({
          ...s,
          sessionStatus: statusFromActive(s.active),
          error: message,
          busyOffer: { projectPath, sessionId: "" },
        }));
        return;
      }
      update((s) => ({ ...s, sessionStatus: "error", error: message }));
      await refreshTree();
    }
  }

  async function openSession(projectPath: string, sessionId: string): Promise<void> {
    update((s) => ({ ...s, sessionStatus: "starting", error: null, busyOffer: null }));
    try {
      const active = await piApi.openSession(projectPath, sessionId);
      update((s) => applySnapshot(s, active));
      await refreshTree();
      await loadModels();
    } catch (err) {
      const message = toError(err);
      if (message === "busy") {
        update((s) => ({
          ...s,
          sessionStatus: statusFromActive(s.active),
          error: message,
          busyOffer: { projectPath, sessionId },
        }));
        return;
      }
      update((s) => ({ ...s, sessionStatus: "error", error: message }));
      await refreshTree();
    }
  }

  async function setModel(provider: string, modelId: string): Promise<void> {
    try {
      const active = await piApi.setModel(provider, modelId);
      update((s) => applySnapshot(s, active));
    } catch (err) {
      update((s) => ({ ...s, error: toError(err) }));
      throw err;
    }
  }

  async function setThinkingLevel(level: string): Promise<void> {
    try {
      const active = await piApi.setThinkingLevel(level);
      update((s) => applySnapshot(s, active));
    } catch (err) {
      update((s) => ({ ...s, error: toError(err) }));
      throw err;
    }
  }

  async function setName(name: string): Promise<void> {
    try {
      const active = await piApi.setName(name);
      update((s) => applySnapshot(s, active));
      await refreshTree();
    } catch (err) {
      update((s) => ({ ...s, error: toError(err) }));
      throw err;
    }
  }

  async function prompt(message: string): Promise<void> {
    const text = message.trim();
    if (!text) return;
    update((s) => ({
      ...s,
      error: null,
      sessionStatus: "streaming",
      streamingText: "",
      messages: [...s.messages, { role: "user", content: text }],
    }));
    try {
      await piApi.prompt(text);
    } catch (err) {
      update((s) => ({
        ...s,
        error: toError(err),
        sessionStatus: statusFromActive(s.active),
      }));
      throw err;
    }
  }

  async function abort(): Promise<void> {
    try {
      const active = await piApi.abort();
      update((s) => applySnapshot(s, active));
    } catch (err) {
      update((s) => ({ ...s, error: toError(err) }));
      throw err;
    }
  }

  async function resyncFromNative(): Promise<void> {
    if (settleSync) {
      await settleSync;
      return;
    }
    settleSync = (async () => {
      try {
        const active = await piApi.snapshot();
        update((s) => applySnapshot(s, active));
      } catch (err) {
        update((s) => ({ ...s, error: toError(err) }));
      } finally {
        settleSync = null;
      }
    })();
    await settleSync;
  }

  async function removeIndexedSession(sessionId: string): Promise<void> {
    try {
      const tree = await piApi.removeIndex(sessionId);
      update((s) => ({ ...s, tree, treeStatus: "ready" }));
    } catch (err) {
      update((s) => ({ ...s, error: toError(err) }));
    }
  }

  function reportError(err: unknown): void {
    update((s) => ({ ...s, error: toError(err) }));
  }

  async function stop(): Promise<void> {
    try {
      await piApi.stop();
      update((s) => ({
        ...s,
        active: null,
        messages: [],
        streamingText: "",
        sessionStatus: "closed",
        availableModels: [],
      }));
    } catch (err) {
      update((s) => ({ ...s, error: toError(err) }));
      throw err;
    }
  }

  function acceptEvent(event: PiEventEnvelope): void {
    let shouldResync = false;
    update((s) => {
      if (!s.active || event.runtimeInstanceId !== s.active.runtimeInstanceId) {
        return s;
      }
      if (event.sessionId && event.sessionId !== s.active.sessionId) {
        return s;
      }
      const reduced = reducePiEvent(
        {
          runtimeInstanceId: s.active.runtimeInstanceId,
          sessionId: s.active.sessionId,
          messages: s.messages,
          streamingText: s.streamingText,
        },
        event,
      );
      const nextActive = { ...s.active };
      const raw = event.raw;
      if (typeof raw.isCompacting === "boolean") {
        nextActive.isCompacting = raw.isCompacting;
      }
      if (event.eventType === "agent_start") {
        nextActive.isStreaming = !nextActive.isCompacting;
      }
      if (event.eventType === "agent_end" || event.eventType === "agent_settled") {
        nextActive.isStreaming = false;
        if (typeof raw.isCompacting !== "boolean") {
          nextActive.isCompacting = false;
        }
        shouldResync = true;
      }
      return {
        ...s,
        active: nextActive,
        messages: reduced.messages,
        streamingText: reduced.streamingText,
        sessionStatus: statusFromActive(nextActive),
      };
    });
    if (shouldResync) {
      void resyncFromNative();
    }
  }

  function dismissBusy(): void {
    update((s) => ({ ...s, busyOffer: null }));
  }

  function snapshot(): PiConsoleState {
    return get({ subscribe });
  }

  return {
    subscribe,
    reset: () => set(initial),
    refreshTree,
    createSession,
    openSession,
    setModel,
    setThinkingLevel,
    setName,
    prompt,
    abort,
    stop,
    acceptEvent,
    dismissBusy,
    loadModels,
    snapshot,
    removeIndexedSession,
    reportError,
  };
}

export const piConsoleStore = createStore();
