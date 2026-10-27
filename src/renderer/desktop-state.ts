import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WS_CHANNELS,
  normalizeSessionTitle,
  type ApprovalMode,
  type AssistantMessage,
  type AskUserQuestionArgs,
  type AskUserQuestionResult,
  type ExtUiRequest,
  type PiEvent,
  type Project,
  type ServerWelcome,
  type SessionEventPayload,
  type SessionState,
  type SessionStateRecord,
  type SessionStats,
  type SessionSummary,
  type SlashCommandInfo,
  type ThinkingLevel,
  type WireModel,
  type Workspace,
} from '@thinkrail/contracts';
import { WsClient, type ConnectionStatus } from './client';
import { parseAskUserQuestionArgs } from './question-schema';
import {
  sessionRuntime,
  toUiMessage,
  type RuntimeView,
  type UiDialogRequest,
  type UiImage,
  type UiMessage,
  type UiToolActivity,
} from './model';

export interface SessionTranscript {
  messages: UiMessage[];
  tools: UiToolActivity[];
}

export interface Selection {
  workspaceId: string;
  sessionId: string;
}

export interface DeletedSession {
  workspaceId: string;
  sessionId: string;
}

export interface AsterState {
  connection: ConnectionStatus;
  booting: boolean;
  projects: Project[];
  workspaces: Workspace[];
  sessions: SessionSummary[];
  transcripts: Record<string, SessionTranscript>;
  records: Record<string, SessionStateRecord>;
  commands: Record<string, SlashCommandInfo[]>;
  /** Unfinished extension UI requests per session, in arrival order; the host holds the real pending map. */
  dialogs: Record<string, UiDialogRequest[]>;
  models: WireModel[];
  stats: Record<string, SessionStats>;
  selected: Selection | null;
  stopRequested: Record<string, true>;
  loading: Record<string, true>;
  error: string | null;
}

export interface ActiveSession {
  session: SessionSummary;
  project: Project | null;
  workspace: Workspace | null;
  messages: UiMessage[];
  tools: UiToolActivity[];
  streaming: boolean;
  stats: SessionStats | null;
}

export interface PendingInput {
  request: UiDialogRequest;
  /** The request belongs to a session the host has not registered yet (startup dialog). */
  startup: boolean;
}

export interface DesktopView {
  connection: ConnectionStatus;
  booting: boolean;
  projects: Project[];
  workspaces: Workspace[];
  sessions: SessionSummary[];
  activeSession: ActiveSession | null;
  runtime: RuntimeView;
  models: WireModel[];
  currentModel: WireModel | null;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  commands: SlashCommandInfo[];
  pendingInput: PendingInput | null;
  pendingQuestion: { toolCallId: string; args: AskUserQuestionArgs; invalid: boolean } | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_TRANSCRIPT: SessionTranscript = { messages: [], tools: [] };
const SELECTION_KEY = 'aster.selection';

export function createAsterState(): AsterState {
  return {
    connection: 'disconnected',
    booting: true,
    projects: [],
    workspaces: [],
    sessions: [],
    transcripts: {},
    records: {},
    commands: {},
    dialogs: {},
    models: [],
    stats: {},
    selected: null,
    stopRequested: {},
    loading: {},
    error: null,
  };
}

export function setConnection(state: AsterState, connection: ConnectionStatus): AsterState {
  return state.connection === connection ? state : { ...state, connection };
}

export function setBooting(state: AsterState, booting: boolean): AsterState {
  return state.booting === booting ? state : { ...state, booting };
}

export function installWelcome(state: AsterState, welcome: ServerWelcome): AsterState {
  const projectIds = new Set(welcome.projects.map(project => project.id));
  const workspaces = state.workspaces.filter(workspace => projectIds.has(workspace.projectId));
  const workspaceIds = new Set(workspaces.map(workspace => workspace.id));
  return {
    ...state,
    projects: welcome.projects,
    workspaces,
    sessions: state.sessions.filter(session => workspaceIds.has(session.workspaceId)),
  };
}

export function upsertProject(state: AsterState, project: Project): AsterState {
  const exists = state.projects.some(item => item.id === project.id);
  return {
    ...state,
    projects: exists
      ? state.projects.map(item => (item.id === project.id ? project : item))
      : [...state.projects, project],
  };
}

export function setWorkspaces(state: AsterState, projectId: string, workspaces: Workspace[]): AsterState {
  const kept = state.workspaces.filter(workspace => workspace.projectId !== projectId);
  return { ...state, workspaces: [...kept, ...workspaces] };
}

export function upsertWorkspace(state: AsterState, workspace: Workspace): AsterState {
  const exists = state.workspaces.some(item => item.id === workspace.id);
  return {
    ...state,
    workspaces: exists
      ? state.workspaces.map(item => (item.id === workspace.id ? workspace : item))
      : [...state.workspaces, workspace],
  };
}

export function removeWorkspace(state: AsterState, workspaceId: string): AsterState {
  const sessionIds = new Set(state.sessions.filter(session => session.workspaceId === workspaceId).map(session => session.sessionId));
  const dialogs = { ...state.dialogs };
  const commands = { ...state.commands };
  const transcripts = { ...state.transcripts };
  const records = { ...state.records };
  for (const sessionId of sessionIds) {
    delete dialogs[sessionId];
    delete commands[sessionId];
    delete transcripts[sessionId];
    delete records[sessionId];
  }
  return {
    ...state,
    workspaces: state.workspaces.filter(workspace => workspace.id !== workspaceId),
    sessions: state.sessions.filter(session => session.workspaceId !== workspaceId),
    selected: state.selected?.workspaceId === workspaceId ? null : state.selected,
    dialogs,
    commands,
    transcripts,
    records,
  };
}

export function setSessions(state: AsterState, workspaceId: string, sessions: SessionSummary[]): AsterState {
  const kept = state.sessions.filter(session => session.workspaceId !== workspaceId);
  const dialogs = sessions.reduce(
    (value, session) => rememberNativeDialog(value, session.sessionId, session.state),
    state.dialogs,
  );
  return { ...state, sessions: [...kept, ...sessions], dialogs };
}

export function upsertSession(state: AsterState, session: SessionSummary): AsterState {
  const exists = state.sessions.some(item => item.sessionId === session.sessionId);
  const dialogs = rememberNativeDialog(state.dialogs, session.sessionId, session.state);
  const sessions = exists
    ? state.sessions.map(item => (item.sessionId === session.sessionId ? session : item))
    : [...state.sessions, session];
  return { ...state, sessions, dialogs };
}

export function updateSession(
  state: AsterState,
  sessionId: string,
  update: (session: SessionSummary) => SessionSummary,
): AsterState {
  return {
    ...state,
    sessions: state.sessions.map(session => (session.sessionId === sessionId ? update(session) : session)),
  };
}

export function removeSession(state: AsterState, payload: DeletedSession): AsterState {
  const dialogs = { ...state.dialogs };
  const commands = { ...state.commands };
  const transcripts = { ...state.transcripts };
  const records = { ...state.records };
  const stats = { ...state.stats };
  delete dialogs[payload.sessionId];
  delete commands[payload.sessionId];
  delete transcripts[payload.sessionId];
  delete records[payload.sessionId];
  delete stats[payload.sessionId];
  return {
    ...state,
    sessions: state.sessions.filter(session => session.sessionId !== payload.sessionId),
    selected: state.selected?.sessionId === payload.sessionId ? null : state.selected,
    dialogs,
    commands,
    transcripts,
    records,
    stats,
  };
}

/** A released session keeps its stored summary but loses every live projection; reopening reloads from the host. */
export function releaseSession(state: AsterState, sessionId: string): AsterState {
  const dialogs = { ...state.dialogs };
  const commands = { ...state.commands };
  const transcripts = { ...state.transcripts };
  const records = { ...state.records };
  const stats = { ...state.stats };
  const stopRequested = { ...state.stopRequested };
  delete dialogs[sessionId];
  delete commands[sessionId];
  delete transcripts[sessionId];
  delete records[sessionId];
  delete stats[sessionId];
  delete stopRequested[sessionId];
  return {
    ...state,
    dialogs,
    commands,
    transcripts,
    records,
    stats,
    stopRequested,
    selected: state.selected?.sessionId === sessionId ? null : state.selected,
  };
}

export function selectSession(state: AsterState, workspaceId: string, sessionId: string): AsterState {
  return { ...state, selected: { workspaceId, sessionId } };
}

export function setTranscript(state: AsterState, sessionId: string, messages: UiMessage[]): AsterState {
  return {
    ...state,
    transcripts: { ...state.transcripts, [sessionId]: { messages, tools: [] } },
  };
}

export function setCommands(state: AsterState, sessionId: string, commands: SlashCommandInfo[]): AsterState {
  return { ...state, commands: { ...state.commands, [sessionId]: commands } };
}

export function setSessionStats(state: AsterState, sessionId: string, stats: SessionStats): AsterState {
  return { ...state, stats: { ...state.stats, [sessionId]: stats } };
}

export function installModels(state: AsterState, models: WireModel[]): AsterState {
  return { ...state, models };
}

export function markLoading(state: AsterState, sessionId: string): AsterState {
  return { ...state, loading: { ...state.loading, [sessionId]: true } };
}

export function clearLoading(state: AsterState, sessionId: string): AsterState {
  return { ...state, loading: withoutKey(state.loading, sessionId) };
}

export function markStopRequested(state: AsterState, sessionId: string): AsterState {
  return { ...state, stopRequested: { ...state.stopRequested, [sessionId]: true } };
}

export function clearStopRequested(state: AsterState, sessionId: string): AsterState {
  if (!state.stopRequested[sessionId]) return state;
  const stopRequested = { ...state.stopRequested };
  delete stopRequested[sessionId];
  return { ...state, stopRequested };
}

export function applyProjectUpdated(state: AsterState, project: Project): AsterState {
  return upsertProject(state, project);
}

const DIALOG_KINDS = new Set<ExtUiRequest['kind']>(['select', 'confirm', 'input', 'editor']);

function isDialogRequest(request: ExtUiRequest): request is UiDialogRequest {
  return DIALOG_KINDS.has(request.kind);
}

function nativeDialogRequest(state: SessionState | null | undefined): UiDialogRequest | null {
  return state?.needsInput?.kind === 'dialog' ? state.needsInput.request : null;
}

/** Keeps the host's pending request by id; re-delivery replaces it without duplicating or reordering. */
function rememberDialog(
  dialogs: Record<string, UiDialogRequest[]>,
  request: UiDialogRequest,
): Record<string, UiDialogRequest[]> {
  const requests = dialogs[request.sessionId] ?? [];
  const index = requests.findIndex(item => item.id === request.id);
  const next = index === -1 ? [...requests, request] : requests.with(index, request);
  return { ...dialogs, [request.sessionId]: next };
}

function forgetDialog(
  dialogs: Record<string, UiDialogRequest[]>,
  sessionId: string,
  id: string,
): Record<string, UiDialogRequest[]> {
  const requests = dialogs[sessionId];
  if (!requests?.some(item => item.id === id)) return dialogs;
  const remaining = requests.filter(item => item.id !== id);
  const next = { ...dialogs };
  if (remaining.length) next[sessionId] = remaining;
  else delete next[sessionId];
  return next;
}

function rememberNativeDialog(
  dialogs: Record<string, UiDialogRequest[]>,
  sessionId: string,
  state: SessionState | null | undefined,
): Record<string, UiDialogRequest[]> {
  const request = nativeDialogRequest(state);
  return request ? rememberDialog(dialogs, { ...request, sessionId }) : dialogs;
}

/** The native needsInput dialog wins for a registered session; otherwise requests answer in arrival order. */
function dialogForSession(state: AsterState, sessionId: string): UiDialogRequest | null {
  const requests = state.dialogs[sessionId];
  if (!requests?.length) return null;
  const session = state.sessions.find(item => item.sessionId === sessionId);
  const native = nativeDialogRequest(state.records[sessionId]?.state ?? session?.state);
  if (native) {
    const match = requests.find(item => item.id === native.id);
    if (match) return match;
  }
  return requests[0];
}

/** The selected session's dialog wins; an unregistered startup dialog stays answerable. */
function pendingDialog(state: AsterState): PendingInput | null {
  const registered = (sessionId: string) => state.sessions.some(session => session.sessionId === sessionId);
  const selectedId = state.selected?.sessionId;
  if (selectedId) {
    const request = dialogForSession(state, selectedId);
    if (request) return { request, startup: !registered(request.sessionId) };
  }
  for (const sessionId of Object.keys(state.dialogs)) {
    if (registered(sessionId)) continue;
    const request = state.dialogs[sessionId][0];
    if (request) return { request, startup: true };
  }
  return null;
}

export function mergeSessionStates(state: AsterState, records: SessionStateRecord[]): AsterState {
  return records.reduce(applySessionState, state);
}

export function applySessionState(state: AsterState, record: SessionStateRecord): AsterState {
  const session = state.sessions.find(item => item.sessionId === record.sessionId);
  const sessions = session
    ? state.sessions.map(item =>
        item.sessionId === record.sessionId ? { ...item, state: record.state } : item,
      )
    : state.sessions;
  const previousNative = nativeDialogRequest(state.records[record.sessionId]?.state ?? session?.state);
  const nextNative = nativeDialogRequest(record.state);
  let dialogs = nextNative
    ? rememberDialog(state.dialogs, nextNative)
    : withoutKey(state.dialogs, record.sessionId);
  if (previousNative && previousNative.id !== nextNative?.id) {
    dialogs = forgetDialog(dialogs, record.sessionId, previousNative.id);
  }
  const transcript = state.transcripts[record.sessionId];
  const transcripts =
    record.state.execution === 'idle' && transcript
      ? { ...state.transcripts, [record.sessionId]: settleTranscript(transcript) }
      : state.transcripts;
  return {
    ...state,
    sessions,
    records: { ...state.records, [record.sessionId]: record },
    dialogs,
    transcripts,
    stopRequested:
      record.state.execution === 'running' ? state.stopRequested : withoutKey(state.stopRequested, record.sessionId),
  };
}

export function applyExtensionUi(state: AsterState, request: ExtUiRequest): AsterState {
  if (request.kind === 'dismiss') return clearDialog(state, request.sessionId, request.id);
  if (!isDialogRequest(request)) return state;
  return { ...state, dialogs: rememberDialog(state.dialogs, request) };
}

/** ACK removes exactly the answered request; it never clears a request that arrived meanwhile. */
export function clearDialog(state: AsterState, sessionId: string, id: string): AsterState {
  const dialogs = forgetDialog(state.dialogs, sessionId, id);
  return dialogs === state.dialogs ? state : { ...state, dialogs };
}

/** Reply target comes from what the UI actually presents, not from the current selection. */
export function replyTarget(state: AsterState): { sessionId: string; request: UiDialogRequest } | null {
  const pending = pendingDialog(state);
  return pending ? { sessionId: pending.request.sessionId, request: pending.request } : null;
}

/** A bound reply is sent only while it is still the dialog the UI presents. */
export function isPendingDialogTarget(state: AsterState, sessionId: string, requestId: string): boolean {
  const pending = pendingDialog(state);
  return pending?.request.sessionId === sessionId && pending.request.id === requestId;
}

/** A bound answer is sent only while native input still points at that session's tool call. */
export function isPendingQuestionTarget(state: AsterState, sessionId: string, toolCallId: string): boolean {
  const view = selectDesktop(state);
  return view.activeSession?.session.sessionId === sessionId && view.pendingQuestion?.toolCallId === toolCallId;
}

/** A session blocked on a host dialog or question must be answered before another prompt is sent. */
export function sessionNeedsInput(state: AsterState, sessionId: string): boolean {
  if ((state.dialogs[sessionId]?.length ?? 0) > 0) return true;
  const session = state.sessions.find(item => item.sessionId === sessionId);
  const record = state.records[sessionId];
  return Boolean((record?.state ?? session?.state)?.needsInput);
}

export function applyPiEvent(state: AsterState, payload: SessionEventPayload): AsterState {
  const event = payload.event;
  if (event.type === 'session_info_changed') return updateSession(state, payload.sessionId, session => ({ ...session, title: event.name ?? '' }));
  if (event.type === 'thinking_level_changed') return updateSession(state, payload.sessionId, session => ({ ...session, thinkingLevel: event.level }));
  const transcript = state.transcripts[payload.sessionId];
  if (!transcript) return state;
  const next = reduceTranscript(transcript, event);
  if (next === transcript) return state;
  return { ...state, transcripts: { ...state.transcripts, [payload.sessionId]: next } };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function settleTranscript(transcript: SessionTranscript): SessionTranscript {
  const messages = transcript.messages.map(message => (message.streaming ? { ...message, streaming: false } : message));
  const tools = transcript.tools.map(tool => (tool.status === 'running' ? { ...tool, status: 'unknown' as const } : tool));
  const changed =
    messages.some((message, index) => message !== transcript.messages[index]) ||
    tools.some((tool, index) => tool !== transcript.tools[index]);
  return changed ? { messages, tools } : transcript;
}

type MessageUpdate = Extract<PiEvent, { type: 'message_update' }>;

function partialAssistant(event: MessageUpdate): AssistantMessage | null {
  const update = event.assistantMessageEvent;
  if ('partial' in update) return update.partial;
  if (update.type === 'done') return update.message;
  if (update.type === 'error') return update.error;
  return null;
}

/** pi streams whole-message snapshots; each update replaces the live assistant message instead of appending deltas. */
function replaceStreaming(messages: UiMessage[], next: UiMessage): UiMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== next.role) continue;
    if (!message.streaming) break;
    const copy = [...messages];
    copy[index] = next;
    return copy;
  }
  return [...messages, next];
}

function toolAt(tools: UiToolActivity[], id: string): UiToolActivity | undefined {
  return tools.find(tool => tool.id === id);
}

function reduceTranscript(transcript: SessionTranscript, event: PiEvent): SessionTranscript {
  switch (event.type) {
    case 'message_start': {
      if (event.message.role !== 'user') return transcript;
      const message = toUiMessage(event.message);
      return message ? { ...transcript, messages: [...transcript.messages, { ...message, streaming: true }] } : transcript;
    }
    case 'message_update': {
      const partial = partialAssistant(event);
      const message = partial ? toUiMessage(partial) : null;
      if (!message) return transcript;
      return { ...transcript, messages: replaceStreaming(transcript.messages, { ...message, streaming: true }) };
    }
    case 'message_end': {
      const message = toUiMessage(event.message);
      if (!message) return transcript;
      return { ...transcript, messages: replaceStreaming(transcript.messages, { ...message, streaming: false }) };
    }
    case 'tool_execution_start': {
      const tool: UiToolActivity = {
        id: event.toolCallId,
        name: event.toolName,
        arguments: event.args,
        status: 'running',
      };
      return {
        ...transcript,
        tools: toolAt(transcript.tools, tool.id)
          ? transcript.tools.map(item => (item.id === tool.id ? { ...tool, arguments: item.arguments } : item))
          : [...transcript.tools, tool],
      };
    }
    case 'tool_execution_update': {
      const existing = toolAt(transcript.tools, event.toolCallId);
      const tool: UiToolActivity = {
        id: event.toolCallId,
        name: existing?.name ?? 'Tool',
        arguments: existing?.arguments ?? null,
        output: event.partialResult,
        status: 'running',
      };
      return {
        ...transcript,
        tools: existing
          ? transcript.tools.map(item => (item.id === tool.id ? tool : item))
          : [...transcript.tools, tool],
      };
    }
    case 'tool_execution_end': {
      const existing = toolAt(transcript.tools, event.toolCallId);
      const tool: UiToolActivity = {
        id: event.toolCallId,
        name: existing?.name ?? 'Tool',
        arguments: existing?.arguments ?? null,
        output: event.result,
        status: event.isError ? 'failed' : 'succeeded',
      };
      return {
        ...transcript,
        tools: existing
          ? transcript.tools.map(item => (item.id === tool.id ? tool : item))
          : [...transcript.tools, tool],
      };
    }
    case 'agent_settled':
      return settleTranscript(transcript);
    default:
      return transcript;
  }
}

export function selectDesktop(state: AsterState): DesktopView {
  const selected = state.selected;
  const session = selected ? state.sessions.find(item => item.sessionId === selected.sessionId) ?? null : null;
  const transcript = session ? state.transcripts[session.sessionId] ?? EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT;
  const record = session ? state.records[session.sessionId] : undefined;
  const input = (record?.state ?? session?.state)?.needsInput;
  const questionId = input?.kind === 'question' ? input.interactionId.slice('question:'.length) : null;
  const questionCall = transcript.messages.flatMap(message => message.content).find(content => content.type === 'toolCall' && content.id === questionId);
  const questionArgs = questionCall?.type === 'toolCall' ? parseAskUserQuestionArgs(questionCall.arguments) : null;
  const pendingQuestion = questionId
    ? { toolCallId: questionId, args: questionArgs ?? { questions: [] }, invalid: questionArgs === null }
    : null;
  const runtime = sessionRuntime(
    state.connection,
    session,
    record?.state ?? session?.state,
    session?.lastSettlement,
    !!session && state.stopRequested[session.sessionId] === true,
  );
  const workspace = session ? state.workspaces.find(item => item.id === session.workspaceId) ?? null : null;
  const activeSession: ActiveSession | null = session
    ? {
        session,
        project: workspace ? state.projects.find(project => project.id === workspace.projectId) ?? null : null,
        workspace,
        messages: transcript.messages,
        tools: transcript.tools,
        streaming: transcript.messages.some(message => message.streaming),
        stats: session ? state.stats[session.sessionId] ?? null : null,
      }
    : null;
  return {
    connection: state.connection,
    booting: state.booting,
    projects: state.projects,
    workspaces: state.workspaces,
    sessions: state.sessions,
    activeSession,
    runtime,
    models: state.models,
    currentModel: session?.model ?? null,
    thinkingLevel: session?.thinkingLevel ?? 'medium',
    availableThinkingLevels: session?.model?.thinkingLevels ?? [],
    commands: session ? state.commands[session.sessionId] ?? [] : [],
    pendingInput: pendingDialog(state),
    pendingQuestion,
    loading: session ? state.loading[session.sessionId] === true : false,
    error: state.error,
  };
}

export function readSelection(storage: Storage | null): Selection | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Selection>;
    return typeof parsed.workspaceId === 'string' && typeof parsed.sessionId === 'string'
      ? { workspaceId: parsed.workspaceId, sessionId: parsed.sessionId }
      : null;
  } catch {
    return null;
  }
}

export function writeSelection(storage: Storage | null, selection: Selection): void {
  try {
    storage?.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    return;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DesktopActions {
  chooseProject(): Promise<void>;
  newSession(projectId?: string): Promise<void>;
  openSession(selection: Selection): Promise<boolean>;
  send(text: string, images?: UiImage[]): Promise<boolean>;
  abort(): Promise<void>;
  release(): Promise<void>;
  setProjectTrust(projectId: string, trusted: boolean): Promise<void>;
  setModel(model: WireModel): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  setApproval(mode: ApprovalMode): Promise<void>;
  renameSession(session: SessionSummary, title: string): Promise<boolean>;
  reply(target: { sessionId: string; requestId: string }, value: string | boolean | null): Promise<void>;
  answerQuestion(target: { sessionId: string; toolCallId: string }, result: AskUserQuestionResult): Promise<void>;
  reportError(message: string): void;
  dismissError(): void;
}

export function useDesktopState(client: WsClient, storage?: Storage | null): {
  view: DesktopView;
  busy: boolean;
  replyPending: boolean;
  questionPending: boolean;
  actions: DesktopActions;
} {
  const [state, setState] = useState<AsterState>(createAsterState);
  const [busy, setBusy] = useState(false);
  const [replyPending, setReplyPending] = useState(false);
  const [questionPending, setQuestionPending] = useState(false);
  const replying = useRef<Set<string>>(new Set());
  const answering = useRef<Set<string>>(new Set());
  const latest = useRef(state);
  latest.current = state;

  const commit = useCallback((update: (current: AsterState) => AsterState) => {
    const next = update(latest.current);
    latest.current = next;
    setState(next);
  }, []);

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      try {
        return await operation();
      } catch (error) {
        commit(current => ({ ...current, error: messageOf(error) }));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [commit],
  );

  const selectionStore = storage === undefined
    ? typeof localStorage === 'undefined' ? null : localStorage
    : storage;

  const loadSession = useCallback(
    async (selection: Selection): Promise<void> => {
      commit(current => markLoading(selectSession(current, selection.workspaceId, selection.sessionId), selection.sessionId));
      writeSelection(selectionStore, selection);
      try {
        const result = await client.request('session.getMessages', {
          sessionId: selection.sessionId,
          workspaceId: selection.workspaceId,
        });
        const messages = result.messages
          .map(toUiMessage)
          .filter((message): message is UiMessage => message !== null);
        commit(current => upsertSession(setTranscript(current, selection.sessionId, messages), result.summary));
        const commands = await client.request('session.getCommands', { sessionId: selection.sessionId });
        commit(current => setCommands(current, selection.sessionId, commands));
        try {
          const stats = await client.request('session.getStats', { sessionId: selection.sessionId });
          commit(current => setSessionStats(current, selection.sessionId, stats));
        } catch (error) {
          commit(current => ({ ...current, error: messageOf(error) }));
        }
      } finally {
        commit(current => clearLoading(current, selection.sessionId));
      }
    },
    [client, commit, selectionStore],
  );

  const refreshSessions = useCallback(
    async (workspaceId: string): Promise<void> => {
      const sessions = await client.request('session.list', { workspaceId });
      commit(current => setSessions(current, workspaceId, sessions));
    },
    [client, commit],
  );

  const ensureWorkspace = useCallback(
    async (projectId: string): Promise<string> => {
      const current = latest.current;
      const preferred = current.selected
        ? current.workspaces.find(workspace => workspace.id === current.selected?.workspaceId && workspace.projectId === projectId)
        : undefined;
      if (preferred) return preferred.id;
      const workspaces = await client.request('workspace.list', { projectId, includeDiffStats: false });
      commit(value => setWorkspaces(value, projectId, workspaces));
      const workspace = workspaces.find(item => item.kind === 'default');
      if (!workspace) throw new Error('The host did not provide the project workspace.');
      return workspace.id;
    },
    [client, commit],
  );

  const createSession = useCallback(
    async (projectId: string): Promise<void> => {
      const workspaceId = await ensureWorkspace(projectId);
      const created = await client.request('session.create', { workspaceId });
      await refreshSessions(workspaceId);
      await loadSession({ workspaceId, sessionId: created.sessionId });
    },
    [client, ensureWorkspace, loadSession, refreshSessions],
  );

  const loadProject = useCallback(
    async (projectId: string): Promise<void> => {
      const workspaces = await client.request('workspace.list', { projectId, includeDiffStats: false });
      commit(current => setWorkspaces(current, projectId, workspaces));
      for (const workspace of workspaces) await refreshSessions(workspace.id);
    },
    [client, commit, refreshSessions],
  );

  const chooseProject = useCallback(async (): Promise<void> => {
    await run(async () => {
      const picked = await client.request('dialog.selectDirectory', {});
      if (!picked.path) return;
      const project = await client.request('project.open', { path: picked.path });
      commit(current => upsertProject(current, project));
      await loadProject(project.id);
      await createSession(project.id);
    });
  }, [client, commit, createSession, loadProject, run]);

  const newSession = useCallback(
    async (projectId?: string): Promise<void> => {
      const current = latest.current;
      const selectedWorkspace = current.selected
        ? current.workspaces.find(workspace => workspace.id === current.selected?.workspaceId)
        : undefined;
      const target = projectId ?? selectedWorkspace?.projectId ?? current.projects[0]?.id;
      if (!target) {
        commit(value => ({ ...value, error: 'Open a project folder before starting a session.' }));
        return;
      }
      await run(() => createSession(target));
    },
    [commit, createSession, run],
  );

  const send = useCallback(
    async (text: string, images: UiImage[] = []): Promise<boolean> => {
      const current = latest.current;
      const session = current.selected
        ? current.sessions.find(item => item.sessionId === current.selected?.sessionId)
        : undefined;
      if (!session || (!text.trim() && images.length === 0)) return false;
      if (sessionNeedsInput(current, session.sessionId)) return false;
      const accepted = await run(async () => {
        // Re-read immediately before sending: a host dialog can arrive while the composer is busy.
        const latestState = latest.current;
        if (sessionNeedsInput(latestState, session.sessionId)) return false;
        const state = latestState.records[session.sessionId]?.state ?? session.state;
        const params = {
          sessionId: session.sessionId,
          text,
          ...(images.length > 0 ? { images: images.map(image => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })) } : {}),
        };
        if (state?.execution === 'running') await client.request('session.followUp', params);
        else await client.request('session.prompt', params);
        return true;
      });
      return accepted === true;
    },
    [client, run],
  );

  const abort = useCallback(async (): Promise<void> => {
    const current = latest.current;
    const sessionId = current.selected?.sessionId;
    if (!sessionId) return;
    await run(async () => {
      commit(value => markStopRequested(value, sessionId));
      try {
        await client.request('session.abort', { sessionId });
      } catch (error) {
        commit(value => clearStopRequested(value, sessionId));
        throw error;
      }
    });
  }, [client, commit, run]);

  const release = useCallback(async (): Promise<void> => {
    const current = latest.current;
    const session = current.selected
      ? current.sessions.find(item => item.sessionId === current.selected?.sessionId)
      : undefined;
    if (!session) return;
    await run(async () => {
      await client.request('session.dispose', { sessionId: session.sessionId });
      commit(value => releaseSession(value, session.sessionId));
      await refreshSessions(session.workspaceId);
    });
  }, [client, commit, refreshSessions, run]);

  const setProjectTrust = useCallback(
    async (projectId: string, trusted: boolean): Promise<void> => {
      await run(async () => {
        const project = await client.request('project.setTrust', { id: projectId, trusted, resources: trusted });
        commit(value => upsertProject(value, project));
      });
    },
    [client, commit, run],
  );

  const setModel = useCallback(
    async (model: WireModel): Promise<void> => {
      const sessionId = latest.current.selected?.sessionId;
      if (!sessionId) return;
      await run(async () => {
        await client.request('session.setModel', { sessionId, model });
        commit(value => updateSession(value, sessionId, session => ({ ...session, model })));
      });
    },
    [client, commit, run],
  );

  const setThinking = useCallback(
    async (level: ThinkingLevel): Promise<void> => {
      const sessionId = latest.current.selected?.sessionId;
      if (!sessionId) return;
      await run(async () => {
        await client.request('session.setThinkingLevel', { sessionId, level });
        commit(value => updateSession(value, sessionId, session => ({ ...session, thinkingLevel: level })));
      });
    },
    [client, commit, run],
  );

  const setApproval = useCallback(
    async (mode: ApprovalMode): Promise<void> => {
      const sessionId = latest.current.selected?.sessionId;
      if (!sessionId) return;
      await run(async () => {
        await client.request('session.setApproval', { sessionId, mode });
        commit(value => updateSession(value, sessionId, session => ({ ...session, approvalMode: mode })));
      });
    },
    [client, commit, run],
  );

  const renameSession = useCallback(
    async (session: SessionSummary, title: string): Promise<boolean> => {
      const clean = normalizeSessionTitle(title);
      if (!clean) {
        commit(value => ({ ...value, error: 'Session titles must be 1-80 characters on one line.' }));
        return false;
      }
      const done = await run(async () => {
        await client.request('session.rename', {
          workspaceId: session.workspaceId,
          sessionId: session.sessionId,
          title: clean,
        });
        commit(value => updateSession(value, session.sessionId, item => ({ ...item, title: clean })));
        return true;
      });
      return done === true;
    },
    [client, commit, run],
  );

  const reply = useCallback(
    async (target: { sessionId: string; requestId: string }, value: string | boolean | null): Promise<void> => {
      if (!isPendingDialogTarget(latest.current, target.sessionId, target.requestId)) return;
      if (replying.current.has(target.requestId)) return;
      replying.current.add(target.requestId);
      setReplyPending(true);
      try {
        await client.request('session.extUiReply', { response: { id: target.requestId, value } });
        commit(state => clearDialog(state, target.sessionId, target.requestId));
      } catch (error) {
        commit(state => ({ ...state, error: messageOf(error) }));
      } finally {
        replying.current.delete(target.requestId);
        setReplyPending(false);
      }
    },
    [client, commit],
  );

  const answerQuestion = useCallback(async (
    target: { sessionId: string; toolCallId: string },
    result: AskUserQuestionResult,
  ): Promise<void> => {
    if (!isPendingQuestionTarget(latest.current, target.sessionId, target.toolCallId)) return;
    if (answering.current.has(target.toolCallId)) return;
    answering.current.add(target.toolCallId);
    setQuestionPending(true);
    try {
      await client.request('session.answerQuestion', { sessionId: target.sessionId, toolCallId: target.toolCallId, result });
    } catch (error) {
      commit(state => ({ ...state, error: messageOf(error) }));
    } finally {
      answering.current.delete(target.toolCallId);
      setQuestionPending(false);
    }
  }, [client, commit]);

  const reportError = useCallback((message: string): void => {
    const clean = message.trim();
    if (!clean) return;
    commit(value => ({ ...value, error: clean }));
  }, [commit]);

  const dismissError = useCallback((): void => {
    commit(value => (value.error === null ? value : { ...value, error: null }));
  }, [commit]);

  useEffect(() => {
    let alive = true;
    let generation = 0;
    let hydrating = false;
    let buffered: SessionStateRecord[] = [];

    const offStatus = client.onStatus(status => commit(state => setConnection(state, status)));

    const offWelcome = client.subscribe(WS_CHANNELS.serverWelcome, data => {
      const welcome = data as ServerWelcome;
      if (typeof welcome?.protocolVersion !== 'number' || !Array.isArray(welcome.projects)) return;
      const current = ++generation;
      hydrating = false;
      buffered = [];
      commit(state => installWelcome(state, welcome));
      void (async () => {
        try {
          for (const project of welcome.projects) {
            const workspaces = await client.request('workspace.list', { projectId: project.id, includeDiffStats: false });
            if (!alive || current !== generation) return;
            commit(state => setWorkspaces(state, project.id, workspaces));
            for (const workspace of workspaces) {
              const sessions = await client.request('session.list', { workspaceId: workspace.id });
              if (!alive || current !== generation) return;
              commit(state => setSessions(state, workspace.id, sessions));
            }
          }
          if (!alive || current !== generation) return;
          hydrating = true;
          const [records, models] = await Promise.all([
            client.request('session.stateList', {}),
            client.request('model.list', {}),
          ]);
          if (!alive || current !== generation) return;
          hydrating = false;
          const pending = buffered;
          buffered = [];
          commit(state => installModels(mergeSessionStates(state, records), models));
          if (pending.length) commit(state => pending.reduce(applySessionState, state));
          const saved = readSelection(selectionStore);
          if (saved) {
            const known = latest.current.sessions.find(
              session => session.sessionId === saved.sessionId && session.workspaceId === saved.workspaceId,
            );
            if (known) await loadSession(saved);
          }
        } catch (error) {
          commit(state => ({ ...state, error: messageOf(error) }));
        } finally {
          if (current === generation) {
            hydrating = false;
            const leftover = buffered;
            buffered = [];
            if (leftover.length) commit(state => leftover.reduce(applySessionState, state));
            if (alive) commit(state => setBooting(state, false));
          }
        }
      })();
    });

    const syncStats = (session: SessionSummary): Promise<void> => client
      .request('session.getStats', { sessionId: session.sessionId })
      .then(stats => { if (alive) commit(state => setSessionStats(state, session.sessionId, stats)); });

    const offEvent = client.subscribe(WS_CHANNELS.piEvent, data => {
      const payload = data as SessionEventPayload;
      if (typeof payload?.sessionId !== 'string' || !payload.event) return;
      commit(state => applyPiEvent(state, payload));
      const transcript = latest.current.transcripts[payload.sessionId];
      const session = latest.current.sessions.find(item => item.sessionId === payload.sessionId);
      // Compaction changes what Pi can trust: getStats may now report an unknown
      // count until the next response, so refresh the ring instead of keeping stale numbers.
      if (payload.event.type === 'compaction_end' && session) {
        void syncStats(session).catch(error => { if (alive) commit(state => ({ ...state, error: messageOf(error) })); });
      }
      if (payload.event.type !== 'agent_settled' || !transcript || !session) return;
      void client.request('session.getMessages', { sessionId: session.sessionId, workspaceId: session.workspaceId }).then(result => {
        if (!alive) return;
        const messages = result.messages.map(toUiMessage).filter((message): message is UiMessage => message !== null);
        commit(state => state.transcripts[session.sessionId] === transcript
          ? upsertSession(setTranscript(state, session.sessionId, messages), result.summary)
          : state);
        return syncStats(session);
      }).catch(error => {
        if (alive) commit(state => ({ ...state, error: messageOf(error) }));
      });
    });

    const offExtensionUi = client.subscribe(WS_CHANNELS.piExtensionUi, data => {
      const request = data as ExtUiRequest;
      if (typeof request?.sessionId !== 'string' || typeof request.id !== 'string') return;
      commit(state => applyExtensionUi(state, request));
    });

    const offState = client.subscribe(WS_CHANNELS.sessionState, data => {
      const record = data as SessionStateRecord;
      if (typeof record?.sessionId !== 'string' || !record.state) return;
      if (hydrating) {
        buffered.push(record);
        return;
      }
      commit(state => applySessionState(state, record));
    });

    const offCreated = client.subscribe(WS_CHANNELS.sessionCreated, data => {
      const summary = data as SessionSummary;
      if (typeof summary?.sessionId !== 'string') return;
      commit(state => upsertSession(state, summary));
    });

    const offDeleted = client.subscribe(WS_CHANNELS.sessionDeleted, data => {
      const payload = data as DeletedSession;
      if (typeof payload?.sessionId !== 'string') return;
      commit(state => removeSession(state, payload));
    });

    const offProject = client.subscribe(WS_CHANNELS.projectUpdated, data => {
      const project = data as Project;
      if (typeof project?.id !== 'string') return;
      commit(state => applyProjectUpdated(state, project));
    });

    const offWorkspace = client.subscribe(WS_CHANNELS.workspaceCreated, data => {
      const workspace = data as Workspace;
      if (typeof workspace?.id !== 'string') return;
      commit(state => upsertWorkspace(state, workspace));
    });

    const offWorkspaceUpdated = client.subscribe(WS_CHANNELS.workspaceUpdated, data => {
      const workspace = data as Workspace;
      if (typeof workspace?.id !== 'string') return;
      commit(state => upsertWorkspace(state, workspace));
    });

    const offWorkspaceRemoved = client.subscribe(WS_CHANNELS.workspaceRemoved, data => {
      const removed = data as { id?: unknown };
      const id = removed?.id;
      if (typeof id !== 'string') return;
      commit(state => removeWorkspace(state, id));
    });

    client.connect();
    return () => {
      alive = false;
      offStatus();
      offWelcome();
      offEvent();
      offExtensionUi();
      offState();
      offCreated();
      offDeleted();
      offProject();
      offWorkspace();
      offWorkspaceUpdated();
      offWorkspaceRemoved();
      client.close();
    };
  }, [client, commit, loadSession, selectionStore]);

  const openSession = useCallback(
    async (selection: Selection): Promise<boolean> => {
      const result = await run(() => loadSession(selection));
      return result !== null;
    },
    [loadSession, run],
  );

  const actions = useMemo<DesktopActions>(
    () => ({
      chooseProject,
      newSession,
      openSession,
      send,
      abort,
      release,
      setProjectTrust,
      setModel,
      setThinking,
      setApproval,
      renameSession,
      reply,
      answerQuestion,
      reportError,
      dismissError,
    }),
    [chooseProject, newSession, openSession, send, abort, release, setProjectTrust, setModel, setThinking, setApproval, renameSession, reply, answerQuestion, reportError, dismissError],
  );

  const view = useMemo(() => selectDesktop(state), [state]);
  return { view, busy, replyPending, questionPending, actions };
}
