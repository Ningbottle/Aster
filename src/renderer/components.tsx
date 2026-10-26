import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Asterisk, CaretDown, Check, CircleNotch, FolderSimple, WarningCircle, X } from '@phosphor-icons/react';
import type { ThinkingLevel, WireModel } from '@thinkrail/contracts';
import type { DesktopView } from './desktop-state';
import type { UiContent, UiDialogRequest, UiImage, UiMessage, UiToolActivity } from './model';
import { CdsButton as Button } from './cds/Button';
import { ThinkingAccordion } from './cds/Thinking';
import { UserMessageBubble, AssistantMessage } from './cds/Message';
import { PromptComposer } from './Composer';
import { ImageBlock } from './ImageAttachment';
import { ToolCard, ToolGroup } from './ToolViews';
import { RichText } from './RichText';
import { TerminalPanel } from './TerminalPanel';
import type { WsClient } from './client';
import { HomeUsage } from './HomeUsage';

export function CodeWorkspace({ view, client, terminalOpen, onCloseTerminal, onReportError, onChooseProject, onNewSession, onSend, onAbort, onRelease, onSetModel, onSetThinking, onOpenFile, onOpenExternal, onOpenDetails, pending, error, onDismissError }: {
  view: DesktopView; client: WsClient; terminalOpen: boolean; onCloseTerminal: () => void; onReportError: (message: string) => void;
  onChooseProject: () => void; onNewSession: (projectId?: string) => void;
  onSend: (text: string, images: UiImage[]) => Promise<boolean>; onAbort: () => void; onRelease: () => void;
  onSetModel: (model: WireModel) => void; onSetThinking: (level: ThinkingLevel) => void;
  onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void; onOpenDetails: () => void;
  pending: boolean; error: string | null; onDismissError: () => void;
}) {
  const hasMessages = !!view.activeSession?.messages.length;
  return <main className={`workspace ${hasMessages ? 'has-transcript' : 'is-empty'}`}>
    <div className={`workspace-body ${hasMessages ? 'has-transcript' : 'is-empty'}`}>
      <div className="error-slot">{error && <div className="error-banner" role="alert"><WarningCircle size={15} /><span>{error}</span><Button variant="ghost" size="icon" className="icon-button" onClick={onDismissError} aria-label="Dismiss error"><X size={14} /></Button></div>}</div>
      {hasMessages
        ? <div className="conversation-region"><ConversationView view={view} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} /></div>
        : <NewSessionHome view={view} client={client} onChooseProject={onChooseProject} onNewSession={onNewSession} pending={pending} />}
      {terminalOpen && view.activeSession?.workspace && <TerminalPanel client={client} workspaceId={view.activeSession.workspace.id} onClose={onCloseTerminal} onError={onReportError} />}
      <div className="composer-slot is-docked">
        <div className="composer-column">
          <PromptComposer view={view} onChooseProject={onChooseProject} onSend={onSend} onAbort={onAbort} onRelease={onRelease} onSetModel={onSetModel} onSetThinking={onSetThinking} onOpenDetails={onOpenDetails} pending={pending} />
        </div>
      </div>
    </div>
  </main>;
}

const ENVIRONMENT_ROWS = 4;

/** Home activity and real project environments share the new-session content column. */
function NewSessionHome({ view, client, onChooseProject, onNewSession, pending }: {
  view: DesktopView; client: WsClient; onChooseProject: () => void; onNewSession: (projectId?: string) => void; pending: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const footer = useRef<HTMLDivElement>(null);
  const currentProject = view.activeSession?.project ?? null;
  const visibleProjects = view.projects.slice(0, ENVIRONMENT_ROWS);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!footer.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      footer.current?.querySelector<HTMLButtonElement>('.env-choose')?.focus();
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  return <div className="landing-stage">
    <div className="home-overview">
      <h1 className="home-greeting"><Asterisk size={22} aria-hidden="true" /><span>What’s up next?</span></h1>
      <HomeUsage client={client} connection={view.connection} booting={view.booting} />
    <div className="landing-env">
      <div className="env-card">
        {visibleProjects.length > 0 && <div className="env-list" aria-label="Project environments">
          {visibleProjects.map(project => {
            const current = currentProject?.id === project.id;
            return <button type="button" key={project.id} className={`env-row ${current ? 'is-current' : ''}`} title={project.path}
              aria-current={current ? 'true' : undefined} disabled={pending}
              onClick={() => { if (!current) onNewSession(project.id); }}>
              <FolderSimple size={16} />
              <span className="env-row-name">{project.name}</span>
              {current && <Check className="env-row-check" size={15} />}
            </button>;
          })}
        </div>}
        {visibleProjects.length === 0 && <div className="env-empty">
          <p>Open a project folder to start.</p>
          <Button variant="secondary" size="sm" onClick={onChooseProject} disabled={pending}><FolderSimple size={16} />Open folder</Button>
        </div>}
        {visibleProjects.length > 0 && <div className="env-footer" ref={footer}>
          <Button variant="ghost" size="sm" className="env-choose" aria-haspopup="menu" aria-expanded={menuOpen} disabled={pending} onClick={() => setMenuOpen(value => !value)}>
            <span className="env-choose-label">Choose environment</span><CaretDown size={13} />
          </Button>
          {menuOpen && <div className="popover env-menu" role="menu" aria-label="Environments">
            {view.projects.map(project => <Button variant="ghost" size="xs" role="menuitem" key={project.id} className="menu-row project-menu-row" title={project.path} onClick={() => { setMenuOpen(false); if (currentProject?.id !== project.id) onNewSession(project.id); }}>
              <FolderSimple size={16} /><span>{project.name}</span>{currentProject?.id === project.id && <Check size={13} />}
            </Button>)}
            <div className="menu-separator" role="separator" />
            <Button variant="ghost" size="xs" role="menuitem" className="menu-row" onClick={() => { setMenuOpen(false); onChooseProject(); }}>
              <FolderSimple size={16} /><span>Open folder…</span>
            </Button>
          </div>}
        </div>}
      </div>
    </div>
    </div>
  </div>;
}

/** Scroll offsets survive switching sessions; the conversation unmounts while an empty session is shown. */
const conversationPositions = new Map<string, { top: number; pinned: boolean }>();

function ConversationView({ view, onOpenFile, onOpenExternal }: { view: DesktopView; onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const viewport = useRef({ width: 0, height: 0 });
  const [showJump, setShowJump] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const messages = view.activeSession?.messages ?? [];
  const tools = view.activeSession?.tools ?? [];
  const sessionId = view.activeSession?.session.sessionId ?? '';
  const nativeResults = new Map(messages.filter(message => message.role === 'toolResult' && message.toolCallId).map(message => [message.toolCallId!, toolResultActivity(message)]));
  const messageToolIds = new Set(messages.flatMap(message => message.content.flatMap(content => content.type === 'toolCall' ? [content.id] : [])));
  const liveTools = new Map(tools.map(tool => [tool.id, tool]));
  for (const [id, result] of nativeResults) liveTools.set(id, { ...liveTools.get(id), ...result, arguments: liveTools.get(id)?.arguments ?? result.arguments });
  const nativeResultIds = new Set(nativeResults.keys());
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, tools, view.runtime.status]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !sessionId) return;
    const saved = conversationPositions.get(sessionId);
    pinned.current = saved?.pinned ?? true;
    el.scrollTop = pinned.current ? el.scrollHeight : saved?.top ?? el.scrollHeight;
    setShowJump(!pinned.current);
    setScrolled(el.scrollTop > 4);
  }, [sessionId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    viewport.current = { width: el.clientWidth, height: el.clientHeight };
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      viewport.current = { width: el.clientWidth, height: el.clientHeight };
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const resized = viewport.current.width !== el.clientWidth || viewport.current.height !== el.clientHeight;
    if (resized && pinned.current) el.scrollTop = el.scrollHeight;
    viewport.current = { width: el.clientWidth, height: el.clientHeight };
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
    if (sessionId) conversationPositions.set(sessionId, { top: el.scrollTop, pinned: pinned.current });
    setShowJump(!pinned.current);
    setScrolled(el.scrollTop > 4);
  };
  return <>
    <div className="conversation-scroll" ref={scrollRef} onScroll={onScroll} aria-label="Conversation">
      <div className="conversation-column">
        {messages.map((message, index) => <MessageRow key={`${message.timestamp}-${index}`} message={message} tools={liveTools} messageToolIds={messageToolIds} thinkingLive={!!view.activeSession?.streaming && index === messages.length - 1} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} />)}
        {tools.filter(tool => !messageToolIds.has(tool.id) && !nativeResultIds.has(tool.id)).map(tool => <ToolCard key={tool.id} tool={tool} onOpenFile={onOpenFile} />)}
        {view.runtime.status === 'failed' && <div className="runtime-notice error"><WarningCircle size={15} /><span>{view.runtime.detail ?? 'The last turn failed.'}</span></div>}
        {view.runtime.status === 'offline' && <div className="runtime-notice error"><WarningCircle size={15} /><span>{view.runtime.detail ?? 'Disconnected from the local server.'} The transcript is read-only until it reconnects.</span></div>}
        {view.runtime.status === 'stop-requested' && <div className="runtime-notice"><CircleNotch className="spin" size={15} /><span>Stop requested. Waiting for Pi to settle the session…</span></div>}
        {view.runtime.status === 'working' && <div className="stream-indicator"><span /><span /><span />Generating</div>}
      </div>
      {showJump && <Button variant="ghost" size="xs" className="jump-latest" onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; pinned.current = true; setShowJump(false); setScrolled(false); }}><ArrowDown size={14} />Jump to latest</Button>}
    </div>
    {scrolled && <div className="conversation-fade" aria-hidden="true" />}
  </>;
}

type MessageGroup =
  | { kind: 'tools'; items: Extract<UiContent, { type: 'toolCall' }>[] }
  | { kind: 'images'; items: Extract<UiContent, { type: 'image' }>[] }
  | { kind: 'single'; content: UiContent };

function MessageRow({ message, tools, messageToolIds, thinkingLive, onOpenFile, onOpenExternal }: { message: UiMessage; tools: Map<string, UiToolActivity>; messageToolIds: Set<string>; thinkingLive: boolean; onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void }) {
  if (message.role === 'toolResult') {
    if (message.toolCallId && messageToolIds.has(message.toolCallId)) return null;
    return <ToolCard tool={toolResultActivity(message)} onOpenFile={onOpenFile} />;
  }
  const groups: MessageGroup[] = [];
  for (const part of message.content) {
    const previous = groups.at(-1);
    if (part.type === 'toolCall') {
      if (previous?.kind === 'tools') previous.items.push(part);
      else groups.push({ kind: 'tools', items: [part] });
    } else if (part.type === 'image') {
      if (previous?.kind === 'images') previous.items.push(part);
      else groups.push({ kind: 'images', items: [part] });
    } else groups.push({ kind: 'single', content: part });
  }
  const content = <>{groups.map((group, index) => group.kind === 'tools'
    ? <ToolGroup key={index} tools={group.items.map(call => ({ ...(tools.get(call.id) ?? { id: call.id, name: call.name, status: 'unknown' as const }), arguments: tools.get(call.id)?.arguments ?? call.arguments }))} onOpenFile={onOpenFile} />
    : group.kind === 'images'
      ? <ImageBlock key={index} images={group.items.map(image => ({ data: image.data, mimeType: image.mimeType }))} tone={message.role === 'user' ? 'user' : 'assistant'} />
      : <ContentBlock key={index} content={group.content} rich={message.role !== 'user'} thinkingLive={thinkingLive && index === groups.length - 1} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} />)}
    {message.errorMessage && <div className="message-error"><WarningCircle size={14} />{message.errorMessage}</div>}
  </>;
  return <article className={`message ${message.role}`}>
    {message.role === 'user' ? <UserMessageBubble>{content}</UserMessageBubble> : <AssistantMessage>{content}</AssistantMessage>}
  </article>;
}

function ContentBlock({ content, thinkingLive, rich, onOpenFile, onOpenExternal }: { content: UiContent; thinkingLive: boolean; rich: boolean; onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void }) {
  if (content.type === 'text') {
    if (content.text === '') return null;
    return rich ? <RichText text={content.text} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} /> : <div className="text-block">{content.text}</div>;
  }
  if (content.type === 'thinking') return <ThinkingAccordion thoughtText={content.thinking} isThinkingLive={thinkingLive} defaultExpanded={false} />;
  if (content.type === 'toolCall') return null;
  if (content.type === 'image') return <ImageBlock images={[content]} tone={rich ? 'assistant' : 'user'} />;
  return <div className="unsupported-content">Unsupported content: {content.nativeType}</div>;
}

function toolResultActivity(message: UiMessage): UiToolActivity {
  const text = message.content
    .map(content => content.type === 'text' ? content.text : content.type === 'thinking' ? content.thinking : content.type === 'toolCall' ? { name: content.name, arguments: content.arguments } : '')
    .filter(part => part !== '')
    .map(part => typeof part === 'string' ? part : JSON.stringify(part))
    .join('\n');
  const images = message.content.flatMap(content => content.type === 'image' ? [{ data: content.data, mimeType: content.mimeType }] : []);
  return {
    id: message.toolCallId ?? `result-${message.timestamp}-${message.toolName ?? 'tool'}`,
    name: message.toolName ?? 'Tool',
    arguments: null,
    output: text || undefined,
    ...(images.length > 0 ? { images } : {}),
    status: message.isError ? 'failed' : 'succeeded',
  };
}

const dialogInputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line-strong)',
  borderRadius: 7,
  background: 'var(--raised)',
  font: 'inherit',
  resize: 'vertical' as const,
};

/** A Pi extension dialog: the session stays blocked until this answers or cancels. */
export function ExtensionDialog({ request, startup, onReply, pending, error }: { request: UiDialogRequest; startup?: boolean; onReply: (value: string | boolean | null) => void; pending: boolean; error?: string | null }) {
  const [text, setText] = useState(request.kind === 'editor' ? request.prefill ?? '' : '');
  return <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget && !pending) onReply(null); }}>
    <form className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="extension-dialog-title"
      onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); onReply(null); } }}
      onSubmit={event => { event.preventDefault(); if (request.kind === 'input' || request.kind === 'editor') onReply(text); }}>
      <h2 id="extension-dialog-title">{request.title}</h2>
      {startup && <p className="detail-subtle">Session initialization request · {request.sessionId.slice(0, 8)}</p>}
      {request.kind === 'confirm' && <p className="detail-subtle">{request.message}</p>}
      {request.kind === 'select' && <div role="listbox" aria-label={request.title}>{request.options.map(option => <Button variant="ghost" size="xs" role="option" key={option} className="menu-row" disabled={pending} onClick={() => onReply(option)}>{option}</Button>)}</div>}
      {request.kind === 'input' && <input autoFocus value={text} onChange={event => setText(event.target.value)} placeholder={request.placeholder} disabled={pending} aria-label={request.title} />}
      {request.kind === 'editor' && <textarea autoFocus rows={6} value={text} onChange={event => setText(event.target.value)} disabled={pending} aria-label={request.title} style={dialogInputStyle} />}
      {error && <p role="alert">{error}</p>}
      <div className="rename-actions">
        <Button variant="secondary" size="sm" onClick={() => onReply(null)} disabled={pending}>Cancel</Button>
        {request.kind === 'confirm' && <><Button variant="secondary" size="sm" onClick={() => onReply(false)} disabled={pending}>No</Button><Button variant="brand" size="sm" onClick={() => onReply(true)} disabled={pending}>Yes</Button></>}
        {(request.kind === 'input' || request.kind === 'editor') && <Button variant="brand" size="sm" type="submit" disabled={pending}>Send</Button>}
      </div>
    </form>
  </div>;
}
