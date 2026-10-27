import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Asterisk, CaretDown, ChatCircle, Check, Code, DotsThree, FolderSimple, ListChecks, ListDashes, MagnifyingGlass, Plus, SidebarSimple, TerminalWindow, X } from '@phosphor-icons/react';
import type { SessionSummary } from '@thinkrail/contracts';
import type { DesktopView } from './desktop-state';
import type { RuntimeView } from './model';
import { CdsButton as Button } from './cds/Button';
import { StatusDot, type StatusKind } from './cds/Status';
import { useMenuFocus } from './menu-focus';

export function runtimeKind(runtime: RuntimeView): StatusKind {
  switch (runtime.status) {
    case 'offline':
    case 'failed': return 'error';
    case 'working': return 'running';
    case 'stop-requested': return 'clay';
    default: return 'ready';
  }
}

export function runtimeLabel(runtime: RuntimeView) {
  switch (runtime.status) {
    case 'offline': return runtime.detail ?? 'Disconnected';
    case 'ready': return runtime.detail ?? 'Ready';
    case 'working': return runtime.queued > 0 ? `Working · ${runtime.queued} queued` : 'Working';
    case 'stop-requested': return 'Stop requested';
    case 'failed': return 'Last turn failed';
  }
}

export function DesktopShell({ children, busy, sidebarOpen }: { children: ReactNode; busy: boolean; sidebarOpen: boolean }) {
  return <div className={`desktop-shell cds-root ${sidebarOpen ? '' : 'sidebar-collapsed'}`} data-density="compact">
    {children}{busy && <div className="busy-edge" aria-hidden="true" />}
  </div>;
}

export function TitleBar({ view, onToggleSidebar, onBack, onForward, canBack, canForward, onShowDetails, onOpenFolder, detailsOpen, onRename, onRelease, onSetTrust }: {
  view: DesktopView; onToggleSidebar: () => void; onBack: () => void; onForward: () => void; canBack: boolean; canForward: boolean;
  onShowDetails: () => void; onOpenFolder: () => void; detailsOpen: boolean; onRename: (session: SessionSummary) => void; onRelease: () => void;
  onSetTrust: (projectId: string, trusted: boolean) => void;
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
    const outside = (event: PointerEvent) => { if (!titleAnchor.current?.contains(event.target as Node)) setTitleMenuOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      titleAnchor.current?.querySelector<HTMLButtonElement>('.pane-title')?.focus();
      setTitleMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [titleMenuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!sessionMenuAnchor.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      sessionMenuAnchor.current?.querySelector<HTMLButtonElement>('.chrome-button')?.focus();
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const session = view.activeSession?.session;
  const project = view.activeSession?.project ?? null;
  const resourcesTrusted = project?.piResourceTrust === 'granted';
  const hasMessages = (view.activeSession?.messages.length ?? 0) > 0;
  const title = session?.title || (hasMessages ? 'Untitled session' : 'New session');
  const working = view.runtime.status === 'working' || view.runtime.status === 'stop-requested';
  const titled = !!session && hasMessages;
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
      {titled && <Button variant="ghost" size="icon" className={`chrome-button ${detailsOpen ? 'is-active' : ''}`} aria-label="Session details" title="Session details" aria-pressed={detailsOpen} onClick={onShowDetails}><ListChecks size={17} /></Button>}
      {view.activeSession?.workspace && <Button variant="ghost" size="icon" className="chrome-button" title="Open project folder" aria-label="Open project folder" onClick={onOpenFolder}><FolderSimple size={17} /></Button>}
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

export function SessionSidebar({ view, onChooseProject, onNewSession, onOpenSession, onRename, onShowDetails, onToggleTerminal, terminalOpen, pending }: {
  view: DesktopView; onChooseProject: () => void; onNewSession: (projectId?: string) => void; onOpenSession: (session: SessionSummary) => void;
  onRename: (session: SessionSummary) => void; onShowDetails: () => void; onToggleTerminal: () => void; terminalOpen: boolean; pending: boolean;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchor = useRef<HTMLDivElement>(null);
  const morePanel = useRef<HTMLDivElement>(null);
  useMenuFocus(moreOpen ? 'more' : null, morePanel);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => { if (!moreAnchor.current?.contains(event.target as Node)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      moreAnchor.current?.querySelector<HTMLButtonElement>('.nav-item')?.focus();
      setMoreOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);
  const activeId = view.activeSession?.session.sessionId;
  const working = view.runtime.status === 'working' || view.runtime.status === 'stop-requested';
  const projectOf = (session: SessionSummary) => view.workspaces.find(workspace => workspace.id === session.workspaceId)?.projectId;
  const visibleSessions = view.sessions
    .filter(session => session.messageCount > 0 && session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const newSessionCurrent = (view.activeSession?.messages.length ?? 0) === 0;
  return <aside className="sidebar" aria-label="Sessions sidebar">
    <div className="sidebar-mode-row">
      <div className="mode-switch" role="group" aria-label="Workspace mode">
        <button type="button" className="mode-option mode-icon is-disabled" tabIndex={-1} disabled aria-disabled="true" aria-label="Chat is not available in Aster" title="Chat is not available in Aster"><ChatCircle size={17} /></button>
        <button type="button" className="mode-option mode-icon is-disabled" tabIndex={-1} disabled aria-disabled="true" aria-label="List is not available in Aster" title="List is not available in Aster"><ListDashes size={17} /></button>
        <button type="button" className="mode-option mode-selected" tabIndex={-1} aria-pressed="true" aria-label="Code, current mode" title="Code"><Code size={17} weight="bold" /><span>Code</span></button>
      </div>
    </div>
    <nav className="primary-nav" aria-label="Code navigation">
      <Button variant="ghost" size="xs" className={`nav-item new-session-action ${newSessionCurrent ? 'is-current' : ''}`} aria-label="New session" aria-current={newSessionCurrent ? 'page' : undefined} onClick={() => view.projects.length ? onNewSession() : onChooseProject()} disabled={pending}><Plus size={17} /><span>New</span></Button>
      <Button variant="ghost" size="xs" className="nav-item" onClick={onChooseProject} disabled={pending}><FolderSimple size={16} /><span>Open folder</span></Button>
      <div className="sidebar-more-anchor" ref={moreAnchor}><Button variant="ghost" size="xs" className="nav-item" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><DotsThree size={17} /><span>More</span></Button>
        {moreOpen && <div className="popover sidebar-more" role="menu" aria-label="More" ref={morePanel}>
          <Button variant="ghost" size="xs" role="menuitem" className="menu-row" aria-pressed={terminalOpen} disabled={!view.activeSession?.workspace} onClick={() => { setMoreOpen(false); onToggleTerminal(); }}><TerminalWindow size={15} />Terminal</Button>
          <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setMoreOpen(false); onShowDetails(); }}><ListChecks size={15} />Session and runtime</Button>
        </div>}
      </div>
    </nav>
    {searching && <div className="session-search"><MagnifyingGlass size={15} /><input autoFocus aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" aria-label="Close search" onClick={() => { setSearching(false); setQuery(''); }}><X size={14} /></button></div>}
    <div className="session-list" role="list" aria-label="Sessions">
      {view.projects.map(project => {
        const sessions = visibleSessions.filter(session => projectOf(session) === project.id);
        if (query && !sessions.length) return null;
        return <section className="session-group" key={project.id} aria-label={project.name}>
          <div className="session-heading"><span title={project.path}>{project.name}</span><Button variant="ghost" size="icon" className="icon-button" aria-label={`New session in ${project.name}`} title="New session in this folder" disabled={pending} onClick={() => onNewSession(project.id)}><Plus size={15} /></Button></div>
          {sessions.map(session => <div className={`session-row ${activeId === session.sessionId ? 'selected' : ''}`} key={session.sessionId}>
            <Button variant="ghost" size="xs" className="session-open" onClick={() => onOpenSession(session)} disabled={pending} title={session.title || 'Untitled session'}><span className="session-title">{session.title || 'Untitled session'}</span>{session.state?.execution === 'running' && <span className="session-running" aria-label="Working" />}</Button>
            <Button variant="ghost" size="icon" className="icon-button session-more" title="Rename session" aria-label={`Rename ${session.title || 'Untitled session'}`} onClick={() => onRename(session)}><DotsThree size={16} /></Button>
          </div>)}
        </section>;
      })}
      {query && !visibleSessions.length && <p className="search-empty">No matching sessions</p>}
    </div>
    <div className="sidebar-footer">
      <Button variant="ghost" size="xs" className="runtime-footer" onClick={onShowDetails}>
        <span className="brand-avatar" aria-hidden="true"><Asterisk size={16} weight="bold" /></span>
        <span className="runtime-identity"><span className="identity-name">Aster</span><span className="identity-source">· Local</span></span>
        <CaretDown size={12} className="runtime-caret" />
      </Button>
      <span className={`footer-working ${working ? 'is-working' : ''}`} aria-hidden="true" />
      <Button variant="ghost" size="icon" className="icon-button" aria-label="Search sessions" title="Search sessions" onClick={() => setSearching(value => !value)}><MagnifyingGlass size={16} /></Button>
      <span className="sr-only">{runtimeLabel(view.runtime)}</span>
      {view.currentModel && <span className="sr-only">{view.currentModel.name}</span>}
    </div>
  </aside>;
}
