import { get, writable } from "svelte/store";
import type {
  PiActiveSession,
  PiEventEnvelope,
  PiMessage,
  PiModel,
  PiProjectNode,
  PiRuntimeSnapshot,
} from "../../types";
import { invoke } from "../../platform/ipc";
import { piApi } from "./api";
import { setPiRuntimeFacts, getHostRuntimeFacts, piProjectBlocksChange } from "../../platform/runtimeStatus";
import {
  isIgnorableResyncError,
  messagesFromNative,
  reducePiEvent,
  rollbackOptimisticUser,
  snapshotMatchesBinding,
  type BindingKey,
} from "./sessionReducer";

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
  projectBlockOffer: { nextPath: string; message: string } | null;
  runtime: PiRuntimeSnapshot | null;
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
  projectBlockOffer: null,
  runtime: null,
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
    projectBlockOffer: null,
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
  let settleDirty = false;

  async function refreshTree(): Promise<void> {
    update((s) => ({
      ...s,
      treeStatus: s.tree.length > 0 ? s.treeStatus : "loading",
      error: s.treeStatus === "error" ? s.error : null,
    }));
    try {
      const tree = await piApi.refreshTree();
      update((s) => ({ ...s, tree, treeStatus: "ready" }));
    } catch (err) {
      update((s) => ({ ...s, treeStatus: "error", error: toError(err) }));
    }
  }

  async function refreshRuntime(): Promise<void> {
    try {
      const runtime = await piApi.runtimeSnapshot();
      setPiRuntimeFacts(runtime);
      update((s) => ({ ...s, runtime }));
    } catch (err) {
      const unknown = {
        lifecycle: "unknown",
        hasLockedInstall: false,
        projectPath: null,
        sessionId: null,
        runtimeInstanceId: null,
      };
      setPiRuntimeFacts(unknown);
      update((s) => ({
        ...s,
        runtime: unknown,
        error: s.error ?? toError(err),
      }));
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
    update((s) => ({ ...s, sessionStatus: "starting", error: null, busyOffer: null, projectBlockOffer: null }));
    try {
      const active = await piApi.createSession(projectPath);
      update((s) => applySnapshot(s, active));
      await Promise.all([refreshTree(), loadModels(), refreshRuntime()]);
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
    update((s) => ({ ...s, sessionStatus: "starting", error: null, busyOffer: null, projectBlockOffer: null }));
    try {
      const active = await piApi.openSession(projectPath, sessionId);
      update((s) => applySnapshot(s, active));
      await Promise.all([refreshTree(), loadModels(), refreshRuntime()]);
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
    const captured = bindingKey(get({ subscribe }));
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
      update((s) => {
        if (captured && !sameBinding(bindingKey(s), captured)) {
          return s;
        }
        return {
          ...s,
          error: toError(err),
          sessionStatus: statusFromActive(s.active),
          messages: rollbackOptimisticUser(s.messages, text),
        };
      });
      throw err;
    }
  }

  async function abort(): Promise<void> {
    const captured = bindingKey(get({ subscribe }));
    try {
      const active = await piApi.abort();
      update((s) => {
        if (!captured || !sameBinding(bindingKey(s), captured)) {
          return s;
        }
        return applySnapshot(s, active);
      });
    } catch (err) {
      update((s) => {
        if (captured && !sameBinding(bindingKey(s), captured)) {
          return s;
        }
        return { ...s, error: toError(err) };
      });
      throw err;
    }
  }

  async function resyncFromNative(): Promise<void> {
    settleDirty = true;
    if (settleSync) {
      await settleSync;
      return;
    }
    settleSync = (async () => {
      try {
        do {
          settleDirty = false;
          await runOneResync();
        } while (settleDirty);
      } finally {
        settleSync = null;
      }
      if (settleDirty) {
        await resyncFromNative();
      }
    })();
    await settleSync;
  }

  async function runOneResync(): Promise<void> {
    const captured = bindingKey(get({ subscribe }));
    if (!captured) return;
    try {
      const snap = await piApi.snapshot();
      update((s) => {
        const current = bindingKey(s);
        const incoming: BindingKey = {
          runtimeInstanceId: snap.runtimeInstanceId,
          sessionId: snap.sessionId,
          messageCount: Array.isArray(snap.messages) ? snap.messages.length : 0,
        };
        if (!snapshotMatchesBinding(current, captured, incoming)) {
          return s;
        }
        return applySnapshot(s, snap);
      });
    } catch (err) {
      if (isIgnorableResyncError(err)) return;
      update((s) => {
        if (!sameBinding(bindingKey(s), captured)) return s;
        return { ...s, error: toError(err) };
      });
    }
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

  function isProjectGuardMessage(message: string): boolean {
    return message.includes("活动 Pi Session");
  }

  function offerProjectBlock(nextPath: string, message: string): void {
    update((s) => ({ ...s, projectBlockOffer: { nextPath, message }, error: null }));
  }

  function reportProjectChooseError(err: unknown, nextPath: string): void {
    const message = toError(err);
    if (isProjectGuardMessage(message)) {
      offerProjectBlock(nextPath, message);
      return;
    }
    reportError(err);
  }

  function dismissProjectBlock(): void {
    update((s) => ({ ...s, projectBlockOffer: null }));
  }

  async function stopThenChoose(nextPath: string): Promise<void> {
    try {
      await stop();
      await invoke("project_choose", { path: nextPath });
      update((s) => ({ ...s, projectBlockOffer: null, error: null }));
      await refreshTree();
      await refreshRuntime();
    } catch (err) {
      reportProjectChooseError(err, nextPath);
    }
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
      await refreshRuntime();
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
      if (event.eventType === "agent_end") {
        if (typeof raw.isCompacting === "boolean") {
          nextActive.isCompacting = raw.isCompacting;
        }
      }
      // Native get_messages is complete at settled, not agent_end.
      if (event.eventType === "agent_settled") {
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
    offerProjectBlock,
    dismissProjectBlock,
    stopThenChoose,
    reportProjectChooseError,
    loadModels,
    refreshRuntime,
    snapshot,
    removeIndexedSession,
    reportError,
  };
}

function bindingKey(state: PiConsoleState): BindingKey | null {
  if (!state.active) return null;
  return {
    runtimeInstanceId: state.active.runtimeInstanceId,
    sessionId: state.active.sessionId,
    messageCount: state.messages.length,
  };
}

function sameBinding(current: BindingKey | null, captured: BindingKey): boolean {
  return !!current
    && current.runtimeInstanceId === captured.runtimeInstanceId
    && current.sessionId === captured.sessionId;
}

export const piConsoleStore = createStore();

if (import.meta.env.DEV) {
  (
    globalThis as typeof globalThis & {
      __asterDebug?: {
        piConsoleStore: typeof piConsoleStore;
        getHostRuntimeFacts: typeof getHostRuntimeFacts;
        piProjectBlocksChange: typeof piProjectBlocksChange;
      };
    }
  ).__asterDebug = { piConsoleStore, getHostRuntimeFacts, piProjectBlocksChange };
}
