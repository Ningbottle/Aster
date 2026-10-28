import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SESSION_TITLE_MAX_LENGTH, type SessionSummary } from '@thinkrail/contracts';
import { WsClient } from './client';
import { useDesktopState, type Selection } from './desktop-state';
import { CodeWorkspace, ExtensionDialog } from './components';
import { DesktopShell, SessionSidebar, TitleBar, type WorkspaceMode } from './Navigation';
import { SessionDetails } from './SessionDetails';
import { SettingsDialog } from './SettingsDialog';
import { FilePreview } from './FilePreview';
import { WorkspaceLayout } from './WorkspaceLayout';
import { CdsButton } from './cds/Button';
import { QuestionDialog } from './QuestionDialog';
import { openExternal, openFileInWorkspace, openFolder } from './native';
import { useModalFocus } from './modal-focus';
import { preferredSidebarWidth, rememberSidebarWidth } from './sidebar-width';
import { loadedPreferences, persistPreference } from './ui-preferences';

export default function App() {
  const client = useMemo(() => new WsClient(), []);
  const { view, busy, replyPending, questionPending, actions } = useDesktopState(client);
  const [showDetails, setShowDetails] = useState(false);
  /** Stored window-level preferences, restored before the first render. */
  const restored = useRef(loadedPreferences());
  /** Chat and Code are two presentations of the same session. */
  const [mode, setMode] = useState<WorkspaceMode>(restored.current.mode ?? 'code');
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Files opened in the preview pane; the active one owns the pane's content. */
  const [preview, setPreview] = useState<{ paths: string[]; active: string | null }>({ paths: [], active: null });
  /** Left navigation width: a user preference, independent from cards and preview. */
  const [sidebarWidth, setSidebarWidth] = useState(() => preferredSidebarWidth(typeof window === 'undefined' ? 1440 : window.innerWidth));
  /** Share of the workspace row used by the conversation side; stored when a resize settles. */
  const [previewRatio, setPreviewRatio] = useState(restored.current.previewRatio ?? 0.5);
  /** Narrow workspaces show one layer; the last explicit request decides which. */
  const [foreground, setForeground] = useState<'cards' | 'preview'>('preview');
  /** Monotonic focus request for the Context card, cleared whenever the panel closes. */
  const [detailsFocus, setDetailsFocus] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(restored.current.sidebarOpen ?? true);
  /** Last values known to be stored, so restored defaults are not written back. */
  const savedInterface = useRef({ mode, sidebarOpen });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [navigation, setNavigation] = useState<{ entries: Selection[]; index: number }>({ entries: [], index: -1 });
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const activeSessionId = view.activeSession?.session.sessionId ?? null;
  const activeWorkspaceId = view.activeSession?.session.workspaceId ?? null;
  const hasWorkspace = !!view.activeSession?.workspace;
  const pendingInput = view.pendingInput;
  const modalOpen = !!pendingInput || !!view.pendingQuestion || !!renameTarget;
  const questionTarget = view.pendingQuestion && view.activeSession
    ? { sessionId: view.activeSession.session.sessionId, toolCallId: view.pendingQuestion.toolCallId }
    : null;
  // A host dialog is modal: do not leave a rename layer stacked underneath it.
  useEffect(() => {
    if (view.pendingInput || view.pendingQuestion) setRenameTarget(null);
  }, [view.pendingInput, view.pendingQuestion]);
  useEffect(() => { setPreview({ paths: [], active: null }); }, [activeSessionId, activeWorkspaceId]);
  /** Mode and sidebar state are window-level; write them only once they move. */
  useEffect(() => {
    if (savedInterface.current.mode === mode && savedInterface.current.sidebarOpen === sidebarOpen) return;
    savedInterface.current = { mode, sidebarOpen };
    persistPreference({ mode, sidebarOpen });
  }, [mode, sidebarOpen]);
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

  /** Local links and Outputs open the preview pane; the card column keeps its state. */
  const previewFile = useCallback((path: string) => {
    setPreview(current => ({ paths: current.paths.includes(path) ? current.paths : [...current.paths, path], active: path }));
    setForeground('preview');
  }, []);
  const selectPreview = useCallback((path: string) => {
    setPreview(current => ({ ...current, active: path }));
    setForeground('preview');
  }, []);
  /** Closing a tab hands the pane to its neighbour, not to an empty state. */
  const closePreviewTab = useCallback((path: string) => {
    setPreview(current => {
      if (!current.paths.includes(path)) return current;
      const index = current.paths.indexOf(path);
      const paths = current.paths.filter(item => item !== path);
      const active = current.active === path ? (paths[index] ?? paths[index - 1] ?? null) : current.active;
      return { paths, active };
    });
  }, []);
  const closePreviewPanel = useCallback(() => setPreview({ paths: [], active: null }), []);

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
      if (!hasWorkspace || modalOpen) return;
      event.preventDefault();
      setTerminalOpen(value => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasWorkspace, modalOpen]);

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
    if (!showDetails) setForeground('cards');
    setShowDetails(!showDetails);
  }, [showDetails]);
  /** Context never discards the open file; the card column simply becomes visible. */
  const openContextDetails = useCallback(() => {
    setShowDetails(true);
    setForeground('cards');
    setDetailsFocus(value => value + 1);
  }, []);
  /** Chat and Code present the same session; switching only hides Code surfaces
   *  and never discards their state, so switching back restores what was open. */
  const changeMode = useCallback((next: WorkspaceMode) => {
    setMode(next);
  }, []);

  return <DesktopShell busy={busy} sidebarOpen={sidebarOpen} sidebarWidth={sidebarWidth}>
    <TitleBar view={view} mode={mode} onToggleSidebar={() => setSidebarOpen(value => !value)} onBack={() => void navigateSession(-1)} onForward={() => void navigateSession(1)} canBack={!busy && navigation.index > 0} canForward={!busy && navigation.index < navigation.entries.length - 1} onShowDetails={toggleDetails} onOpenFolder={() => void handleOpenFolder()} detailsOpen={showDetails} onRename={beginRename} onRelease={() => void actions.release()} onSetTrust={(projectId, trusted) => void actions.setProjectTrust(projectId, trusted)} terminalOpen={terminalOpen} onToggleTerminal={() => setTerminalOpen(value => !value)} />
    <SessionSidebar view={view} mode={mode} sidebarWidth={sidebarWidth} onModeChange={changeMode}
      onChooseProject={() => void actions.chooseProject()} onNewSession={projectId => { if (view.projects.length === 0) void actions.chooseProject(); else void actions.newSession(projectId); }} onOpenSession={session => void openSession({ workspaceId: session.workspaceId, sessionId: session.sessionId })} onRename={beginRename} onShowDetails={toggleDetails} onOpenSettings={() => setSettingsOpen(true)} onToggleTerminal={() => setTerminalOpen(value => !value)} onWidthChange={setSidebarWidth} onWidthCommit={rememberSidebarWidth} pending={busy} />
    <div className="workspace-row-host">
      <WorkspaceLayout
        cardsOpen={mode === 'code' && showDetails}
        previewOpen={!!preview.active}
        foreground={foreground}
        ratio={previewRatio}
        onRatioChange={setPreviewRatio}
        onRatioCommit={ratio => persistPreference({ previewRatio: ratio })}
        onCloseOverlay={layer => {
          if (layer === 'cards') closeDetails();
          else closePreviewPanel();
        }}
        stage={cards => <CodeWorkspace view={view} client={client} terminalOpen={terminalOpen} onCloseTerminal={() => setTerminalOpen(false)} onReportError={actions.reportError} onChooseProject={() => void actions.chooseProject()} onSend={(text, images) => actions.send(text, images)} onAbort={() => void actions.abort()} onSetApproval={approval => void actions.setApproval(approval)} onSetModel={model => void actions.setModel(model)} onSetThinking={level => void actions.setThinking(level)} onOpenFile={previewFile} onOpenExternal={url => void handleOpenExternal(url)} onOpenDetails={openContextDetails} cards={mode === 'code' ? cards : undefined} showTerminal={mode === 'code'} pending={busy || view.booting} error={view.error} onDismissError={actions.dismissError} />}
        cards={mode === 'code' && showDetails
          ? <SessionDetails view={view} client={client} onClose={closeDetails} onSelectOutput={path => { previewFile(path); }} selectedOutput={preview.active} focusContext={detailsFocus} />
          : null}
        preview={preview.active
          ? <FilePreview view={view} client={client} paths={preview.paths} activePath={preview.active} onSelect={selectPreview} onCloseTab={closePreviewTab} onClosePanel={closePreviewPanel} onOpenFile={path => void handleOpenFile(path)} onOpenExternal={url => void handleOpenExternal(url)} />
          : null}
      />
    </div>
    {pendingInput ? <ExtensionDialog key={pendingInput.request.id} request={pendingInput.request} startup={pendingInput.startup} onReply={value => void actions.reply({ sessionId: pendingInput.request.sessionId, requestId: pendingInput.request.id }, value)} pending={replyPending} error={view.error} />
      : questionTarget && view.pendingQuestion && <QuestionDialog key={questionTarget.toolCallId} args={view.pendingQuestion.args} invalid={view.pendingQuestion.invalid} onReply={result => void actions.answerQuestion(questionTarget, result)} pending={questionPending} error={view.error} />}
    {renameTarget && <RenameSessionDialog draft={renameDraft} pending={busy} onDraft={setRenameDraft} onCancel={() => setRenameTarget(null)} onSave={() => void saveRename()} />}
    {settingsOpen && <SettingsDialog view={view} onClose={() => setSettingsOpen(false)} onSetApproval={approval => void actions.setApproval(approval)} onSetTrust={(projectId, trusted) => void actions.setProjectTrust(projectId, trusted)} onRelease={() => void actions.release()} />}
  </DesktopShell>;
}

function RenameSessionDialog({ draft, pending, onDraft, onCancel, onSave }: {
  draft: string; pending: boolean; onDraft: (title: string) => void; onCancel: () => void; onSave: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, { initialFocusSelector: '#rename-session-input' });
  return <div className="modal-scrim" ref={layer} onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title"
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); onCancel(); } }}
      onSubmit={event => { event.preventDefault(); onSave(); }}>
      <h2 id="rename-title">Rename session</h2>
      <label htmlFor="rename-session-input">Session title</label>
      <input id="rename-session-input" autoFocus value={draft} onChange={event => onDraft(event.target.value)} maxLength={SESSION_TITLE_MAX_LENGTH} />
      <div className="rename-actions"><CdsButton variant="secondary" size="sm" onClick={onCancel} disabled={pending}>Cancel</CdsButton><CdsButton variant="brand" size="sm" type="submit" disabled={pending || !draft.trim()}>Save</CdsButton></div>
    </form>
  </div>;
}
