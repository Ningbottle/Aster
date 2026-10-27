import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CONFIG,
  PROTOCOL_VERSION,
  type AssistantMessage,
  type ExtUiRequest,
  type Project,
  type ServerWelcome,
  type SessionState,
  type SessionStateRecord,
  type SessionSummary,
  type Workspace,
} from '@thinkrail/contracts';
import {
  applyExtensionUi,
  applyPiEvent,
  applySessionState,
  clearDialog,
  createAsterState,
  installWelcome,
  isPendingDialogTarget,
  isPendingQuestionTarget,
  markStopRequested,
  mergeSessionStates,
  readSelection,
  releaseSession,
  replyTarget,
  selectDesktop,
  selectSession,
  sessionNeedsInput,
  setConnection,
  setSessions,
  setTranscript,
  setWorkspaces,
  writeSelection,
  type AsterState,
} from '../../src/renderer/desktop-state';

const project: Project = { id: 'p1', name: 'Aster', path: 'C:/Aster', slug: 'aster', lastOpened: 1 };
const workspace: Workspace = {
  id: 'w1',
  projectId: 'p1',
  name: 'main',
  branch: 'main',
  worktreePath: 'C:/Aster',
  baseBranch: 'main',
};

const welcome: ServerWelcome = {
  protocolVersion: PROTOCOL_VERSION,
  projects: [project],
  recentProjects: [project],
  config: DEFAULT_CONFIG,
};

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 's1',
    workspaceId: 'w1',
    title: 'Session',
    model: null,
    thinkingLevel: 'medium',
    approvalMode: 'auto',
    isStreaming: false,
    messageCount: 2,
    updatedAt: 10,
    live: true,
    ...overrides,
  };
}

function prepared(): AsterState {
  let state = setConnection(installWelcome(createAsterState(), welcome), 'connected');
  state = setWorkspaces(state, project.id, [workspace]);
  state = setSessions(state, workspace.id, [summary(), summary({ sessionId: 's2', title: 'Other' })]);
  state = selectSession(state, workspace.id, 's1');
  state = setTranscript(state, 's1', []);
  return setTranscript(state, 's2', []);
}

function stateRecord(state: Partial<SessionState> = {}): SessionStateRecord {
  return {
    sessionId: 's1',
    workspaceId: 'w1',
    projectId: 'p1',
    state: {
      execution: 'running',
      runId: 'run-1',
      needsInput: null,
      completion: null,
      completionUnread: false,
      queuedCount: 0,
      backgroundWork: false,
      ...state,
    },
  };
}

const assistant = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic-messages',
  provider: 'test',
  model: 'test',
  usage: {
    input: 3,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 5,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 5,
});

function textUpdate(sessionId: string, text: string) {
  const partial = assistant(text);
  return {
    sessionId,
    event: {
      type: 'message_update' as const,
      message: partial,
      assistantMessageEvent: {
        type: 'text_delta' as const,
        contentIndex: 0,
        delta: text,
        partial,
      },
    },
  };
}

describe('pi event streaming', () => {
  test('replaces the live assistant message with each pi snapshot instead of appending deltas', () => {
    let state = prepared();
    state = applyPiEvent(state, textUpdate('s1', 'po'));
    state = applyPiEvent(state, textUpdate('s1', 'pong'));

    const messages = selectDesktop(state).activeSession?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toEqual([{ type: 'text', text: 'pong' }]);
    expect(messages[0].streaming).toBe(true);
    expect(selectDesktop(state).activeSession?.streaming).toBe(true);
  });

  test('keeps a native user message and finalizes assistant text on message_end', () => {
    let state = prepared();
    state = applyPiEvent(state, {
      sessionId: 's1',
      event: { type: 'message_start', message: { role: 'user', content: 'hello', timestamp: 4 } },
    });
    state = applyPiEvent(state, {
      sessionId: 's1',
      event: { type: 'message_end', message: { role: 'user', content: 'hello', timestamp: 4 } },
    });
    state = applyPiEvent(state, textUpdate('s1', 'hello'));
    state = applyPiEvent(state, {
      sessionId: 's1',
      event: { type: 'message_end', message: assistant('hello there') },
    });

    const messages = selectDesktop(state).activeSession?.messages ?? [];
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toEqual([{ type: 'text', text: 'hello there' }]);
    expect(messages[1].streaming).toBe(false);
  });

  test('does not cross session boundaries', () => {
    let state = prepared();
    state = applyPiEvent(state, textUpdate('s2', 'other session'));
    state = applyPiEvent(state, textUpdate('s1', 'mine'));

    expect(state.transcripts.s2.messages).toHaveLength(1);
    expect(state.transcripts.s2.messages[0].content).toEqual([{ type: 'text', text: 'other session' }]);
    expect(state.transcripts.s1.messages).toHaveLength(1);
    expect(state.transcripts.s1.messages[0].content).toEqual([{ type: 'text', text: 'mine' }]);
    expect(selectDesktop(state).activeSession?.messages).toBe(state.transcripts.s1.messages);
  });

  test('ignores events for sessions without a loaded transcript', () => {
    const state = prepared();
    const next = applyPiEvent(state, textUpdate('s-unknown', 'ignored'));
    expect(next).toBe(state);
    expect(next.transcripts['s-unknown']).toBeUndefined();
  });

  test('tracks tool execution per session and marks unobserved results unknown on settle', () => {
    let state = prepared();
    state = applyPiEvent(state, {
      sessionId: 's1',
      event: { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' } },
    });
    state = applyPiEvent(state, {
      sessionId: 's1',
      event: { type: 'tool_execution_update', toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' }, partialResult: 'listing' },
    });
    expect(state.transcripts.s1.tools[0]).toMatchObject({ name: 'bash', status: 'running', output: 'listing' });
    expect(state.transcripts.s2.tools).toHaveLength(0);

    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'agent_settled', terminal: null } });
    expect(state.transcripts.s1.tools[0].status).toBe('unknown');
  });
});

describe('session state', () => {
  test('agent_end does not settle the session', () => {
    let state = prepared();
    state = applyPiEvent(state, textUpdate('s1', 'half'));
    state = applySessionState(state, stateRecord());

    state = applyPiEvent(state, {
      sessionId: 's1',
      event: { type: 'agent_end', messages: [], willRetry: false },
    });

    expect(selectDesktop(state).runtime.status).toBe('working');
    expect(state.transcripts.s1.messages[0].streaming).toBe(true);
  });

  test('idle session.state settles runtime and transcript, and stop requests clear', () => {
    let state = prepared();
    state = applyPiEvent(state, textUpdate('s1', 'partial'));
    state = applySessionState(state, stateRecord());
    state = markStopRequested(state, 's1');
    expect(selectDesktop(state).runtime.status).toBe('stop-requested');

    state = applySessionState(state, stateRecord({
      execution: 'idle',
      runId: null,
      completion: { completionId: 'c1', outcome: 'succeeded' },
    }));

    expect(selectDesktop(state).runtime.status).toBe('ready');
    expect(state.transcripts.s1.messages[0].streaming).toBe(false);
    expect(state.stopRequested.s1).toBeUndefined();
  });

  test('a failed completion surfaces the settlement error', () => {
    let state = prepared();
    state = setSessions(state, workspace.id, [summary({ lastSettlement: { stopReason: 'error', errorMessage: 'rate limited' } })]);
    state = selectSession(state, workspace.id, 's1');
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      runId: null,
      completion: { completionId: 'c1', outcome: 'failed', failure: 'error' },
    }));

    expect(selectDesktop(state).runtime).toMatchObject({ status: 'failed', detail: 'rate limited' });
  });

  test('a snapshot list installs the newest record per session and later pushes win', () => {
    let state = prepared();
    const idle = stateRecord({ execution: 'idle', runId: null });
    const running = stateRecord({ runId: 'run-2', queuedCount: 2 });
    state = mergeSessionStates(state, [idle, running]);

    const runtime = selectDesktop(state).runtime;
    expect(runtime.status).toBe('working');
    expect(runtime.queued).toBe(2);
    expect(state.records.s1).toBe(running);
  });

  test('queued work and background work are projected from upstream state', () => {
    let state = prepared();
    state = applySessionState(state, stateRecord({ queuedCount: 1 }));
    expect(selectDesktop(state).runtime).toMatchObject({ status: 'working', queued: 1 });
    expect(state.sessions.find(session => session.sessionId === 's1')?.state?.runId).toBe('run-1');
  });

  test('uses the native summary state before a live state push arrives', () => {
    const state = setSessions(prepared(), workspace.id, [summary({ state: stateRecord().state })]);
    expect(selectDesktop(state).runtime.status).toBe('working');
  });

  test('keeps background work visible when foreground execution is idle', () => {
    const state = applySessionState(prepared(), stateRecord({ execution: 'idle', backgroundWork: true }));
    expect(selectDesktop(state).runtime).toMatchObject({ status: 'working', backgroundWork: true });
  });

  test('applies native title and thinking changes', () => {
    let state = prepared();
    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'session_info_changed', name: 'Native name' } });
    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'thinking_level_changed', level: 'high' } });
    expect(selectDesktop(state).activeSession?.session.title).toBe('Native name');
    expect(selectDesktop(state).thinkingLevel).toBe('high');
  });

  test('exposes the actual tool question referenced by native input state', () => {
    let state = prepared();
    const args = { questions: [{ header: 'Target', question: 'Which target?', options: [{ label: 'Local', description: 'This workspace' }] }] };
    const message = assistant('');
    message.content = [{ type: 'toolCall', id: 'q1', name: 'ask_user_question', arguments: args }];
    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'message_end', message } });
    state = applySessionState(state, stateRecord({ needsInput: { kind: 'question', interactionId: 'question:q1' } }));
    expect(selectDesktop(state).pendingQuestion).toEqual({ toolCallId: 'q1', args, invalid: false });
    state = applySessionState(state, stateRecord({ needsInput: null }));
    expect(selectDesktop(state).pendingQuestion).toBeNull();
  });

  test('keeps an unreadable question visible as a cancel-only target', () => {
    let state = prepared();
    const message = assistant('');
    message.content = [{
      type: 'toolCall',
      id: 'q1',
      name: 'ask_user_question',
      arguments: { questions: [{ header: 'Target', question: 'Which?', options: 42 }] },
    }];
    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'message_end', message } });
    state = applySessionState(state, stateRecord({ needsInput: { kind: 'question', interactionId: 'question:q1' } }));

    expect(selectDesktop(state).pendingQuestion).toEqual({
      toolCallId: 'q1',
      args: { questions: [] },
      invalid: true,
    });
    expect(isPendingQuestionTarget(state, 's1', 'q1')).toBe(true);
  });
});

describe('extension dialogs', () => {
  const selectRequest: ExtUiRequest = {
    id: 'ask-1',
    sessionId: 's1',
    kind: 'select',
    title: 'Choose a target',
    options: ['staging', 'production'],
  };

  test('projects a dialog for the selected session only', () => {
    let state = prepared();
    state = applyExtensionUi(state, selectRequest);
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-1');
    expect(selectDesktop(state).pendingInput?.startup).toBe(false);

    const other = selectSession(state, 'w1', 's2');
    expect(selectDesktop(other).pendingInput).toBeNull();
  });

  test('a session.state needsInput dialog is authoritative and clearing matches the id', () => {
    let state = prepared();
    state = applyExtensionUi(state, selectRequest);
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'ask-1', kind: 'dialog', request: selectRequest },
    }));
    expect(selectDesktop(state).pendingInput?.request.kind).toBe('select');

    state = clearDialog(state, 's1', 'another-id');
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-1');

    state = clearDialog(state, 's1', 'ask-1');
    expect(selectDesktop(state).pendingInput).toBeNull();
  });

  test('a session blocked on a dialog or question reports needsInput', () => {
    let state = prepared();
    expect(sessionNeedsInput(state, 's1')).toBe(false);

    state = applyExtensionUi(state, selectRequest);
    expect(sessionNeedsInput(state, 's1')).toBe(true);
    state = clearDialog(state, 's1', selectRequest.id);
    expect(sessionNeedsInput(state, 's1')).toBe(false);

    state = applySessionState(state, stateRecord({
      needsInput: { kind: 'question', interactionId: 'question:q1' },
    }));
    expect(sessionNeedsInput(state, 's1')).toBe(true);
    expect(sessionNeedsInput(state, 's2')).toBe(false);

    state = applySessionState(state, stateRecord({ needsInput: null }));
    expect(sessionNeedsInput(state, 's1')).toBe(false);
  });

  test('non-dialog extension UI requests are not rendered', () => {
    let state = prepared();
    state = applyExtensionUi(state, { id: 'n1', sessionId: 's1', kind: 'notify', message: 'hi', level: 'info' });
    expect(selectDesktop(state).pendingInput).toBeNull();
  });

  test('keeps two concurrent requests in arrival order and ACK removes only the answered id', () => {
    let state = prepared();
    state = applyExtensionUi(state, { ...selectRequest, id: 'ask-1', title: 'First' });
    state = applyExtensionUi(state, { ...selectRequest, id: 'ask-2', title: 'Second' });
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-1');

    state = applyExtensionUi(state, { ...selectRequest, id: 'ask-3', title: 'Third' });
    state = clearDialog(state, 's1', 'ask-1');
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-2');

    state = clearDialog(state, 's1', 'ask-2');
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-3');

    state = clearDialog(state, 's1', 'ask-3');
    expect(selectDesktop(state).pendingInput).toBeNull();
  });

  test('a native needsInput dialog is not replaced by a later request', () => {
    let state = prepared();
    const native = { ...selectRequest, id: 'native-1', title: 'Native' };
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'native-1', kind: 'dialog', request: native },
    }));
    state = applyExtensionUi(state, { ...selectRequest, id: 'late-1', title: 'Late' });
    expect(selectDesktop(state).pendingInput?.request.id).toBe('native-1');

    state = clearDialog(state, 's1', 'native-1');
    expect(selectDesktop(state).pendingInput?.request.id).toBe('late-1');
  });

  test('a state push that precedes its request event projects exactly one request', () => {
    let state = prepared();
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'ask-1', kind: 'dialog', request: selectRequest },
    }));
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-1');

    state = applyExtensionUi(state, selectRequest);
    expect(state.dialogs.s1).toHaveLength(1);
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-1');
  });

  test('restores a native dialog from the session snapshot before any live event', () => {
    const native = { ...selectRequest, id: 'snap-1' };
    let state = prepared();
    state = setSessions(state, workspace.id, [summary({
      state: stateRecord({
        execution: 'idle',
        needsInput: { interactionId: 'snap-1', kind: 'dialog', request: native },
      }).state,
    })]);
    expect(selectDesktop(state).pendingInput?.request.id).toBe('snap-1');
  });

  test('clearing native state closes the dialog and a late ACK does not revive it', () => {
    let state = prepared();
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'ask-1', kind: 'dialog', request: selectRequest },
    }));
    state = applySessionState(state, stateRecord({ execution: 'idle', needsInput: null }));
    expect(selectDesktop(state).pendingInput).toBeNull();

    state = clearDialog(state, 's1', 'ask-1');
    expect(selectDesktop(state).pendingInput).toBeNull();
  });

  test('switching the native dialog drops the previous request', () => {
    const first = { ...selectRequest, id: 'ask-1' };
    const second = { ...selectRequest, id: 'ask-2', title: 'Second' };
    let state = prepared();
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'ask-1', kind: 'dialog', request: first },
    }));
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'ask-2', kind: 'dialog', request: second },
    }));
    expect(state.dialogs.s1).toHaveLength(1);
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-2');
  });

  test('a dismiss event removes only its request', () => {
    let state = prepared();
    state = applyExtensionUi(state, selectRequest);
    state = applyExtensionUi(state, { ...selectRequest, id: 'ask-2' });
    state = applyExtensionUi(state, { id: 'ask-1', sessionId: 's1', kind: 'dismiss' });
    expect(selectDesktop(state).pendingInput?.request.id).toBe('ask-2');
  });

  test('a reply bound to a superseded dialog is dropped instead of rerouted to the visible one', () => {
    let state = prepared();
    state = applyExtensionUi(state, { ...selectRequest, id: 'a-1' });
    expect(isPendingDialogTarget(state, 's1', 'a-1')).toBe(true);

    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'b-1', kind: 'dialog', request: { ...selectRequest, id: 'b-1' } },
    }));
    expect(selectDesktop(state).pendingInput?.request.id).toBe('b-1');
    expect(isPendingDialogTarget(state, 's1', 'a-1')).toBe(false);
    expect(isPendingDialogTarget(state, 's1', 'b-1')).toBe(true);
    expect(isPendingDialogTarget(state, 's2', 'b-1')).toBe(false);
  });

  test('a native record without a dialog clears stale projections for that session only', () => {
    let state = prepared();
    state = applySessionState(state, stateRecord({
      execution: 'idle',
      needsInput: { interactionId: 'a-1', kind: 'dialog', request: { ...selectRequest, id: 'a-1' } },
    }));
    state = applyExtensionUi(state, { ...selectRequest, id: 'b-1' });
    state = applyExtensionUi(state, { ...selectRequest, sessionId: 's2', id: 'b-2' });
    state = applySessionState(state, stateRecord({ execution: 'idle', needsInput: null }));

    expect(state.dialogs.s1).toBeUndefined();
    expect(selectDesktop(state).pendingInput).toBeNull();
    expect(state.dialogs.s2?.map(request => request.id)).toEqual(['b-2']);
  });

  test('a native question record clears a stale dialog projection that would mask it', () => {
    let state = prepared();
    state = applyExtensionUi(state, { ...selectRequest, id: 'b-1' });
    state = applySessionState(state, stateRecord({
      needsInput: { kind: 'question', interactionId: 'question:q1' },
    }));

    expect(state.dialogs.s1).toBeUndefined();
    expect(selectDesktop(state).pendingInput).toBeNull();
  });

  test('a question answer bound to a superseded tool call is dropped', () => {
    let state = prepared();
    const args = { questions: [{ header: 'Target', question: 'Which target?', options: [{ label: 'Local', description: 'This workspace' }] }] };
    const first = assistant('');
    first.content = [{ type: 'toolCall', id: 'q1', name: 'ask_user_question', arguments: args }];
    const second = assistant('');
    second.content = [{ type: 'toolCall', id: 'q2', name: 'ask_user_question', arguments: args }];
    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'message_end', message: first } });
    state = applyPiEvent(state, { sessionId: 's1', event: { type: 'message_end', message: second } });

    state = applySessionState(state, stateRecord({ needsInput: { kind: 'question', interactionId: 'question:q1' } }));
    expect(isPendingQuestionTarget(state, 's1', 'q1')).toBe(true);
    state = applySessionState(state, stateRecord({ needsInput: { kind: 'question', interactionId: 'question:q2' } }));
    expect(isPendingQuestionTarget(state, 's1', 'q1')).toBe(false);
    expect(isPendingQuestionTarget(state, 's1', 'q2')).toBe(true);
    expect(isPendingQuestionTarget(state, 's2', 'q2')).toBe(false);
  });

  test('clearing a session keeps an unregistered startup request answerable', () => {
    let state = prepared();
    const boot = { ...selectRequest, sessionId: 'boot-1', id: 'ask-boot' };
    state = applyExtensionUi(state, boot);
    state = applySessionState(state, stateRecord({ execution: 'idle', needsInput: null }));

    expect(state.dialogs['boot-1']).toHaveLength(1);
    expect(selectDesktop(state).pendingInput).toEqual({ request: boot, startup: true });
    expect(isPendingDialogTarget(state, 'boot-1', 'ask-boot')).toBe(true);
  });

  test('a startup dialog is answerable without a session summary and keeps the selection', () => {
    const base = prepared();
    const startupRequest: ExtUiRequest = { ...selectRequest, sessionId: 'boot-1', id: 'ask-boot' };
    const state = applyExtensionUi(base, startupRequest);
    const view = selectDesktop(state);

    expect(view.activeSession?.session.sessionId).toBe('s1');
    expect(view.pendingInput).toEqual({ request: startupRequest, startup: true });
    expect(replyTarget(state)).toMatchObject({ sessionId: 'boot-1', request: { id: 'ask-boot' } });
  });

  test('a startup dialog shows when no session is selected', () => {
    let state = installWelcome(createAsterState(), welcome);
    state = setWorkspaces(state, project.id, [workspace]);
    state = setSessions(state, workspace.id, [summary()]);
    const request: ExtUiRequest = { ...selectRequest, sessionId: 'boot-2', id: 'ask-boot-2' };
    state = applyExtensionUi(state, request);

    const view = selectDesktop(state);
    expect(view.activeSession).toBeNull();
    expect(view.pendingInput).toEqual({ request, startup: true });
  });

  test('releasing a session clears its pending requests', () => {
    let state = prepared();
    state = applyExtensionUi(state, selectRequest);
    state = releaseSession(state, 's1');
    expect(state.dialogs.s1).toBeUndefined();
    expect(selectDesktop(state).pendingInput).toBeNull();
  });
});

describe('selection restore', () => {
  test('stores only workspace and session references', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as unknown as Storage;

    writeSelection(storage, { workspaceId: 'w1', sessionId: 's1' });
    expect([...values.values()]).toEqual([JSON.stringify({ workspaceId: 'w1', sessionId: 's1' })]);
    expect(readSelection(storage)).toEqual({ workspaceId: 'w1', sessionId: 's1' });

    values.set('aster.selection', '{not json');
    expect(readSelection(storage)).toBeNull();
  });

  test('a welcome snapshot drops sessions of projects that are no longer open', () => {
    let state = prepared();
    state = installWelcome(state, { ...welcome, projects: [], recentProjects: [] });
    expect(state.projects).toEqual([]);
    expect(state.workspaces).toEqual([]);
    expect(state.sessions).toEqual([]);
  });
});
