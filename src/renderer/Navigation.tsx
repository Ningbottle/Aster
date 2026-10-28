import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Asterisk,
  CaretDown,
  ChatsCircle,
  Check,
  Code,
  DotsThree,
  FolderSimple,
  Gear,
  ListChecks,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
  Terminal,
  TerminalWindow,
  X,
} from '@phosphor-icons/react';
import type { SessionSummary } from '@thinkrail/contracts';
import type { DesktopView } from './desktop-state';
import { CdsButton as Button } from './cds/Button';
import { StatusDot } from './cds/Status';
import { useMenuFocus } from './menu-focus';
import { SidebarResizer } from './SidebarResizer';
import { runtimeKind, runtimeLabel } from './runtime-status';

/**
 * Chat and Code are two presentations of the same Pi session: switching them
 * never creates, forks, cancels or re-permissions a session. Code adds the
 * project surfaces (terminal, information rail, folder actions); Chat keeps the
 * conversation and the composer only.
 */
export type WorkspaceMode = 'chat' | 'code';

const MODES = [
  { id: 'chat' as const, label: 'Chat' },
  { id: 'code' as const, label: 'Code' },
];

export function DesktopShell({ children, busy, sidebarOpen, sidebarWidth }: {
  children: ReactNode; busy: boolean; sidebarOpen: boolean; sidebarWidth: number;
}) {
  return <div className={`desktop-shell cds-root ${sidebarOpen ? '' : 'sidebar-collapsed'}`} data-density="compact"
    style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    {children}{busy && <div className="busy-edge" aria-hidden="true" />}
  </div>;
}

export function TitleBar({ view, mode, onToggleSidebar, onBack, onForward, canBack, canForward, onShowDetails, onOpenFolder, detailsOpen, onRename, onRelease, onSetTrust, terminalOpen, onToggleTerminal }: {
  view: DesktopView; mode: WorkspaceMode; onToggleSidebar: () => void; onBack: () => void; onForward: () => void; canBack: boolean; canForward: boolean;
  onShowDetails: () => void; onOpenFolder: () => void; detailsOpen: boolean; onRename: (session: SessionSummary) => void; onRelease: () => void;
  onSetTrust: (projectId: string, trusted: boolean) => void; terminalOpen: boolean; onToggleTerminal: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const titleAnchor = useRef<HTMLDivElement>(null);
  const sessionMenuAnchor = useRef<HTMLDivElement>(null);
  const titleMenuPanel = useRef<HTMLDivElement>(null);
  const sessionMenuPanel = useRef<HTMLDivElement>(null);
  useMenuFocus(titleMenuOpen ? 'title' : null, titleMenuPanel);
  useMenuFocus(menuOpen ? 'session' : null, sessionMenuPanel);
  useEffect(() => {
    if (!titleMenuOpen) return;
    const outside = (event: Event) => { if (!titleAnchor.current?.contains(event.target as Node)) setTitleMenuOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      titleAnchor.current?.querySelector<HTMLButtonElement>('.pane-title')?.focus();
      setTitleMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [titleMenuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: Event) => { if (!sessionMenuAnchor.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      sessionMenuAnchor.current?.querySelector<HTMLButtonElement>('.chrome-button')?.focus();
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const session = view.activeSession?.session;
  const project = view.activeSession?.project ?? null;
  const resourcesTrusted = project?.piResourceTrust === 'granted';
  const hasMessages = (view.activeSession?.messages.length ?? 0) > 0;
  const title = session?.title || (hasMessages ? 'Untitled session' : 'New session');
  const working = view.runtime.status === 'working' || view.runtime.status === 'stop-requested';
  const titled = !!session && hasMessages;
  const code = mode === 'code';
  return <header className="window-titlebar">
    <div className="window-navigation">
      <Button variant="ghost" size="icon" className="chrome-button sidebar-toggle" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={onToggleSidebar}><SidebarSimple size={17} />{working && <span className="chrome-indicator" aria-hidden="true" />}</Button>
      <Button variant="ghost" size="icon" className="chrome-button" aria-label="Back" title="Back" disabled={!canBack} onClick={onBack}><ArrowLeft size={16} /></Button>
      <Button variant="ghost" size="icon" className="chrome-button" aria-label="Forward" title="Forward" disabled={!canForward} onClick={onForward}><ArrowRight size={16} /></Button>
    </div>
    <div className="pane-title-anchor" ref={titleAnchor}>
      {titled && session
        ? <button type="button" className="pane-title" aria-haspopup="menu" aria-expanded={titleMenuOpen} onClick={() => { setMenuOpen(false); setTitleMenuOpen(value => !value); }}>
          <span className="pane-title-text">{title}</span><CaretDown size={12} />
        </button>
        : <div className="pane-title new-session-title">New session</div>}
      {titled && session && titleMenuOpen && <div className="popover title-menu pane-title-menu" role="menu" aria-label="Session" ref={titleMenuPanel}>
        <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setTitleMenuOpen(false); onRename(session); }}>Rename session</Button>
        <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setTitleMenuOpen(false); onShowDetails(); }}>Session details</Button>
        <div className="menu-separator" role="separator" />
        <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setTitleMenuOpen(false); onOpenFolder(); }}><FolderSimple size={14} />Open project folder</Button>
      </div>}
    </div>
    <div className="pane-actions">
      {code && titled && <Button variant="ghost" size="icon" className="chrome-button" aria-label="Toggle terminal" title="Toggle terminal" aria-pressed={terminalOpen} onClick={onToggleTerminal}><Terminal size={16} /></Button>}
      {code && titled && <Button variant="ghost" size="icon" className={`chrome-button ${detailsOpen ? 'is-active' : ''}`} aria-label="Session details" title="Session details" aria-pressed={detailsOpen} onClick={onShowDetails}><ListChecks size={16} /></Button>}
      {code && view.activeSession?.workspace && <Button variant="ghost" size="icon" className="chrome-button" title="Open project folder" aria-label="Open project folder" onClick={onOpenFolder}><FolderSimple size={17} /></Button>}
      {session && <div className="title-menu-anchor" ref={sessionMenuAnchor}><Button variant="ghost" size="icon" className="chrome-button" aria-label="Session menu" aria-expanded={menuOpen} onClick={() => { setTitleMenuOpen(false); setMenuOpen(value => !value); }}><DotsThree size={18} weight="bold" /></Button>
        {menuOpen && <div className="popover title-menu" role="menu" aria-label="Session menu" ref={sessionMenuPanel}>
          <Button variant="ghost" size="xs" role="menuitem" className="menu-row" aria-label="Rename session" onClick={() => { setMenuOpen(false); onRename(session); }}>Rename session</Button>
          <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setMenuOpen(false); onOpenFolder(); }}><FolderSimple size={14} />Open project folder</Button>
          <div className="menu-separator" role="separator" />
          <div className="menu-heading">Runtime</div>
          <div className="menu-status"><StatusDot kind={runtimeKind(view.runtime)} label={runtimeLabel(view.runtime)} /></div>
          {project && <>
            <div className="menu-separator" role="separator" />
            <Button variant="ghost" size="xs" role="menuitemcheckbox" aria-checked={resourcesTrusted} className="menu-row" onClick={() => { setMenuOpen(false); onSetTrust(project.id, !resourcesTrusted); }}>
              <span className="menu-check">{resourcesTrusted && <Check size={13} />}</span>
              Trust project resources
            </Button>
            <p className="menu-footnote">Loads .pi settings, skills, MCP and extensions. Does not sandbox tools.</p>
          </>}
          <div className="menu-separator" role="separator" />
          <Button variant="ghost" size="xs" role="menuitem" className="menu-row danger" onClick={() => { setMenuOpen(false); onRelease(); }}><X size={14} />Release session</Button>
          <p className="menu-footnote">Release unloads the session runtime; the transcript stays on disk.</p>
        </div>}
      </div>}
    </div>
    <div className="native-controls-space" aria-hidden="true" />
  </header>;
}

export function SessionSidebar({ view, mode, sidebarWidth, onModeChange, onChooseProject, onNewSession, onOpenSession, onRename, onShowDetails, onOpenSettings, onToggleTerminal, onWidthChange, onWidthCommit, pending }: {
  view: DesktopView; mode: WorkspaceMode; sidebarWidth: number;
  onModeChange: (mode: WorkspaceMode) => void;
  onChooseProject: () => void; onNewSession: (projectId?: string) => void; onOpenSession: (session: SessionSummary) => void;
  onRename: (session: SessionSummary) => void; onShowDetails: () => void; onOpenSettings: () => void; onToggleTerminal: () => void;
  onWidthChange: (width: number) => void; onWidthCommit: (width: number) => void;
  pending: boolean;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const moreAnchor = useRef<HTMLDivElement>(null);
  const morePanel = useRef<HTMLDivElement>(null);
  const modeButtons = useRef<Record<WorkspaceMode, HTMLButtonElement | null>>({ chat: null, code: null });
  useMenuFocus(moreOpen ? 'more' : null, morePanel);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: Event) => { if (!moreAnchor.current?.contains(event.target as Node)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      moreAnchor.current?.querySelector<HTMLButtonElement>('.nav-item')?.focus();
      setMoreOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);
  const activeId = view.activeSession?.session.sessionId;
  const working = view.runtime.status === 'working' || view.runtime.status === 'stop-requested';
  const projectOf = (session: SessionSummary) => view.workspaces.find(workspace => workspace.id === session.workspaceId)?.projectId;
  const workspaceName = (workspaceId: string) => view.workspaces.find(workspace => workspace.id === workspaceId)?.name ?? '';
  const visibleSessions = view.sessions
    .filter(session => session.messageCount > 0 && session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const newSessionCurrent = (view.activeSession?.messages.length ?? 0) === 0;
  const toggleProject = (projectId: string) => setCollapsedProjects(current => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    return next;
  });
  /** Arrow keys move between the two modes without leaving the group. */
  const onModeKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: WorkspaceMode = mode === 'chat' ? 'code' : 'chat';
    onModeChange(next);
    modeButtons.current[next]?.focus();
  };
  return <aside className="sidebar" aria-label="Workspace navigation">
    <div className="sidebar-brand">
      <Asterisk size={15} weight="bold" aria-hidden="true" />
      <span className="sidebar-brand-name">Aster</span>
      <span className="sr-only">{runtimeLabel(view.runtime)}</span>
      {view.currentModel && <span className="sr-only">{view.currentModel.name}</span>}
    </div>
    <div className="sidebar-mode-row">
      <div className="mode-switch" role="radiogroup" aria-label="Workspace mode" onKeyDown={onModeKeyDown}>
        {MODES.map(entry => <button type="button" key={entry.id} role="radio" aria-checked={mode === entry.id}
          tabIndex={mode === entry.id ? 0 : -1}
          className={`mode-option mode-${entry.id} ${mode === entry.id ? 'mode-selected' : ''}`}
          ref={element => { modeButtons.current[entry.id] = element; }}
          onClick={() => onModeChange(entry.id)}>
          {entry.id === 'chat' ? <ChatsCircle size={15} /> : <Code size={15} weight="bold" />}
          <span>{entry.label}</span>
        </button>)}
      </div>
    </div>
    <nav className="primary-nav" aria-label={`${mode === 'chat' ? 'Chat' : 'Code'} navigation`}>
      <Button variant="ghost" size="xs" className={`nav-item new-session-action ${newSessionCurrent ? 'is-current' : ''}`} aria-label="New session" aria-current={newSessionCurrent ? 'page' : undefined} onClick={() => onNewSession()} disabled={pending}><span className="nav-icon" data-cds-part="icon"><Plus size={14} /></span><span>New</span></Button>
      <Button variant="ghost" size="xs" className="nav-item" onClick={onChooseProject} disabled={pending}><span className="nav-icon" data-cds-part="icon"><FolderSimple size={14} /></span><span>Open folder</span></Button>
      <div className="sidebar-more-anchor" ref={moreAnchor}><Button variant="ghost" size="xs" className="nav-item" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><span className="nav-icon" data-cds-part="icon"><DotsThree size={14} /></span><span>More</span></Button>
        {moreOpen && <div className="popover sidebar-more" role="menu" aria-label="More" ref={morePanel}>
          <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setMoreOpen(false); setSearching(true); }}><MagnifyingGlass size={15} />Search sessions</Button>
          {mode === 'code' && <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setMoreOpen(false); onShowDetails(); }}><ListChecks size={15} />Session and runtime</Button>}
          {mode === 'code' && <Button variant="ghost" size="xs" role="menuitem" className="menu-row" disabled={!view.activeSession?.workspace} onClick={() => { setMoreOpen(false); onToggleTerminal(); }}><TerminalWindow size={15} />Toggle terminal</Button>}
        </div>}
      </div>
    </nav>
    {searching && <div className="session-search"><MagnifyingGlass size={15} /><input autoFocus aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" aria-label="Close search" onClick={() => { setSearching(false); setQuery(''); }}><X size={14} /></button></div>}
    <div className="session-list" role="list" aria-label="Sessions">
      {view.projects.map(project => {
        const rows = visibleSessions.filter(session => projectOf(session) === project.id);
        if (query && !rows.length) return null;
        /** Only disclose a workspace label when the project actually has several. */
        const multiWorkspace = new Set(rows.map(session => session.workspaceId)).size > 1;
        return <section className="session-group" key={project.id} aria-label={project.name}>
          <div className="session-heading">
            <button type="button" className="session-heading-toggle" aria-expanded={!collapsedProjects.has(project.id)} aria-controls={`session-group-${project.id}`}
              onClick={() => toggleProject(project.id)} title={project.path}>
              <span className="nav-icon"><CaretDown size={12} aria-hidden="true" /></span><span>{project.name}</span>
            </button>
            <Button variant="ghost" size="icon" className="icon-button" aria-label={`New session in ${project.name}`} title="New session in this folder" disabled={pending} onClick={() => onNewSession(project.id)}><Plus size={14} /></Button>
          </div>
          {!collapsedProjects.has(project.id) && <div id={`session-group-${project.id}`}>
            {rows.map(session => <div className={`session-row ${activeId === session.sessionId ? 'selected' : ''}`} key={session.sessionId}>
              <Button variant="ghost" size="xs" className="session-open" onClick={() => onOpenSession(session)} disabled={pending} title={session.workspaceId && multiWorkspace ? `${session.title || 'Untitled session'} · ${workspaceName(session.workspaceId)}` : session.title || 'Untitled session'}>
                <span className="session-title">{session.title || 'Untitled session'}</span>
                {multiWorkspace && <span className="session-workspace">{workspaceName(session.workspaceId)}</span>}
                {session.state?.execution === 'running' && <span className="session-running" aria-label="Working" />}
              </Button>
              <Button variant="ghost" size="icon" className="icon-button session-more" title="Rename session" aria-label={`Rename ${session.title || 'Untitled session'}`} onClick={() => onRename(session)}><DotsThree size={14} /></Button>
            </div>)}
            {rows.length === 0 && <p className="session-empty">No sessions yet</p>}
          </div>}
        </section>;
      })}
      {query && !visibleSessions.length && <p className="search-empty">No matching sessions</p>}
    </div>
    <div className="sidebar-footer">
      <button type="button" className="settings-entry" onClick={onOpenSettings} aria-haspopup="dialog">
        <Gear size={15} aria-hidden="true" />
        <span>Settings</span>
        {working && <span className="footer-working is-working" aria-hidden="true" />}
      </button>
    </div>
    <SidebarResizer width={sidebarWidth} onChange={onWidthChange} onCommit={onWidthCommit} />
  </aside>;
}
