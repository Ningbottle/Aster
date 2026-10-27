import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SESSION_TITLE_MAX_LENGTH, type SessionSummary } from '@thinkrail/contracts';
import { WsClient } from './client';
import { useDesktopState, type Selection } from './desktop-state';
import { CodeWorkspace, ExtensionDialog } from './components';
import { DesktopShell, SessionSidebar, TitleBar } from './Shell';
import { SessionDetails } from './SessionDetails';
import { CdsButton } from './cds/Button';
import { QuestionDialog } from './QuestionDialog';
import { openExternal, openFileInWorkspace, openFolder } from './native';
import { useModalFocus } from './modal-focus';

export default function App() {
  const client = useMemo(() => new WsClient(), []);
  const { view, busy, replyPending, questionPending, actions } = useDesktopState(client);
  const [showDetails, setShowDetails] = useState(false);
  /** Monotonic focus request for the Context card, cleared whenever the panel closes. */
  const [detailsFocus, setDetailsFocus] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [navigation, setNavigation] = useState<{ entries: Selection[]; index: number }>({ entries: [], index: -1 });
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const activeSessionId = view.activeSession?.session.sessionId ?? null;
  const activeWorkspaceId = view.activeSession?.session.workspaceId ?? null;
  const hasWorkspace = !!view.activeSession?.workspace;
  const pendingInput = view.pendingInput;
  const questionTarget = view.pendingQuestion && view.activeSession
    ? { sessionId: view.activeSession.session.sessionId, toolCallId: view.pendingQuestion.toolCallId }
    : null;
  // A host dialog is modal: do not leave a rename layer stacked underneath it.
  useEffect(() => {
    if (view.pendingInput || view.pendingQuestion) setRenameTarget(null);
  }, [view.pendingInput, view.pendingQuestion]);
  const handleOpenFolder = useCallback(async () => {
    if (!activeWorkspaceId) {
      actions.reportError('No project folder is selected.');
      return;
    }
    const result = await openFolder(activeWorkspaceId);
    if (!result.ok) actions.reportError(result.error ?? 'The project folder could not be opened.');
  }, [actions, activeWorkspaceId]);

  const handleOpenFile = useCallback(async (path: string) => {
    if (!activeWorkspaceId) {
      actions.reportError('No project folder is selected.');
      return;
    }
    const result = await openFileInWorkspace(activeWorkspaceId, path);
    if (!result.ok) actions.reportError(result.error ?? `The file could not be opened: ${path}`);
  }, [actions, activeWorkspaceId]);

  const handleOpenExternal = useCallback(async (url: string) => {
    const result = await openExternal(url);
    if (!result.ok) actions.reportError(result.error ?? `The link could not be opened: ${url}`);
  }, [actions]);

  useEffect(() => {
    if (!activeSessionId || !activeWorkspaceId) return;
    const current = { workspaceId: activeWorkspaceId, sessionId: activeSessionId };
    setNavigation(history => history.entries[history.index]?.sessionId === current.sessionId
      ? history
      : { entries: [...history.entries.slice(0, history.index + 1), current], index: history.index + 1 });
  }, [activeSessionId, activeWorkspaceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.code !== 'Backquote') return;
      if (!hasWorkspace) return;
      event.preventDefault();
      setTerminalOpen(value => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasWorkspace]);

  const openSession = useCallback(async (selection: Selection) => {
    await actions.openSession(selection);
  }, [actions]);

  const navigateSession = useCallback(async (offset: number) => {
    const index = navigation.index + offset;
    const target = navigation.entries[index];
    if (!target) return;
    setNavigation(current => ({ ...current, index }));
    await actions.openSession(target);
  }, [actions, navigation]);

  const beginRename = useCallback((session: SessionSummary) => {
    setRenameTarget(session);
    setRenameDraft(session.title);
  }, []);

  const saveRename = useCallback(async () => {
    if (!renameTarget) return;
    if (await actions.renameSession(renameTarget, renameDraft)) setRenameTarget(null);
  }, [actions, renameDraft, renameTarget]);

  const closeDetails = useCallback(() => {
    setShowDetails(false);
    setDetailsFocus(0);
  }, []);
  const toggleDetails = useCallback(() => {
    setDetailsFocus(0);
    setShowDetails(value => !value);
  }, []);
  const openContextDetails = useCallback(() => {
    setShowDetails(true);
    setDetailsFocus(value => value + 1);
  }, []);

  return <DesktopShell busy={busy} sidebarOpen={sidebarOpen}>
    <TitleBar view={view} onToggleSidebar={() => setSidebarOpen(value => !value)} onBack={() => void navigateSession(-1)} onForward={() => void navigateSession(1)} canBack={!busy && navigation.index > 0} canForward={!busy && navigation.index < navigation.entries.length - 1} onShowDetails={toggleDetails} onOpenFolder={() => void handleOpenFolder()} detailsOpen={showDetails} onRename={beginRename} onRelease={() => void actions.release()} onSetTrust={(projectId, trusted) => void actions.setProjectTrust(projectId, trusted)} />
    <SessionSidebar view={view} onChooseProject={() => void actions.chooseProject()} onNewSession={projectId => void actions.newSession(projectId)} onOpenSession={session => void openSession({ workspaceId: session.workspaceId, sessionId: session.sessionId })} onRename={beginRename} onShowDetails={toggleDetails} onToggleTerminal={() => setTerminalOpen(value => !value)} terminalOpen={terminalOpen} pending={busy} />
    <CodeWorkspace view={view} client={client} terminalOpen={terminalOpen} onCloseTerminal={() => setTerminalOpen(false)} onReportError={actions.reportError} onChooseProject={() => void actions.chooseProject()} onSend={(text, images) => actions.send(text, images)} onAbort={() => void actions.abort()} onSetApproval={mode => void actions.setApproval(mode)} onSetModel={model => void actions.setModel(model)} onSetThinking={level => void actions.setThinking(level)} onOpenFile={path => void handleOpenFile(path)} onOpenExternal={url => void handleOpenExternal(url)} onOpenDetails={openContextDetails} pending={busy || view.booting} error={view.error} onDismissError={actions.dismissError} />
    {showDetails && <SessionDetails view={view} client={client} onClose={closeDetails} onOpenFile={path => void handleOpenFile(path)} focusContext={detailsFocus} />}
    {pendingInput ? <ExtensionDialog key={pendingInput.request.id} request={pendingInput.request} startup={pendingInput.startup} onReply={value => void actions.reply({ sessionId: pendingInput.request.sessionId, requestId: pendingInput.request.id }, value)} pending={replyPending} error={view.error} />
      : questionTarget && view.pendingQuestion && <QuestionDialog key={questionTarget.toolCallId} args={view.pendingQuestion.args} invalid={view.pendingQuestion.invalid} onReply={result => void actions.answerQuestion(questionTarget, result)} pending={questionPending} error={view.error} />}
    {renameTarget && <RenameSessionDialog draft={renameDraft} pending={busy} onDraft={setRenameDraft} onCancel={() => setRenameTarget(null)} onSave={() => void saveRename()} />}
  </DesktopShell>;
}

function RenameSessionDialog({ draft, pending, onDraft, onCancel, onSave }: {
  draft: string; pending: boolean; onDraft: (title: string) => void; onCancel: () => void; onSave: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { initialFocusSelector: '#rename-session-input' });
  return <div className="modal-scrim" ref={layer} onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}
      onSubmit={event => { event.preventDefault(); onSave(); }}>
      <h2 id="rename-title">Rename session</h2>
      <label htmlFor="rename-session-input">Session title</label>
      <input id="rename-session-input" autoFocus value={draft} onChange={event => onDraft(event.target.value)} maxLength={SESSION_TITLE_MAX_LENGTH} />
      <div className="rename-actions"><CdsButton variant="secondary" size="sm" onClick={onCancel} disabled={pending}>Cancel</CdsButton><CdsButton variant="brand" size="sm" type="submit" disabled={pending || !draft.trim()}>Save</CdsButton></div>
    </form>
  </div>;
}
