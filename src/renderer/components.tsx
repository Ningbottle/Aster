import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, CircleNotch, WarningCircle, X } from '@phosphor-icons/react';
import type { ApprovalMode, ThinkingLevel, WireModel } from '@thinkrail/contracts';
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
import { useModalFocus } from './modal-focus';
import { Skeleton, SkeletonGroup } from './cds/Skeleton';
import { StatusDot } from './cds/Status';
import { distanceFromBottom, isPinned, shouldFollow, showsJump } from './scroll-follow';
import { turnMetaIndexes } from './conversation-turns';

export function CodeWorkspace({ view, client, terminalOpen, onCloseTerminal, onReportError, onChooseProject, onSend, onAbort, onSetApproval, onSetModel, onSetThinking, onOpenFile, onOpenExternal, onOpenDetails, cards, showTerminal, pending, error, onDismissError }: {
  view: DesktopView; client: WsClient; terminalOpen: boolean; onCloseTerminal: () => void; onReportError: (message: string) => void;
  onChooseProject: () => void;
  onSend: (text: string, images: UiImage[]) => Promise<boolean>; onAbort: () => void; onSetApproval: (mode: ApprovalMode) => void;
  onSetModel: (model: WireModel) => void; onSetThinking: (level: ThinkingLevel) => void;
  onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void; onOpenDetails: () => void;
  /** Docked information cards; they live inside the conversation's scroll viewport. */
  cards?: ReactNode;
  /** Code-only surface: Chat keeps the conversation and the composer. */
  showTerminal: boolean;
  pending: boolean; error: string | null; onDismissError: () => void;
}) {
  const hasMessages = !!view.activeSession?.messages.length;
  const awaitingInput = !!view.pendingInput || !!view.pendingQuestion;
  const preparation = view.sessionAction === 'choosing-project' ? 'Waiting for a project folder…'
    : view.sessionAction === 'creating-session' ? 'Preparing session…'
      : view.booting ? 'Restoring workspace…' : null;
  return <main className={`workspace ${hasMessages ? 'has-transcript' : 'is-empty'}`}>
    <div className={`workspace-body ${hasMessages ? 'has-transcript' : 'is-empty'}`}>
      <div className="error-slot">{preparation && !view.loading && <div className="runtime-notice" role="status"><StatusDot kind="running" label={preparation} /></div>}{error && <div className="error-banner" role="alert"><WarningCircle size={15} /><span>{error}</span><Button variant="ghost" size="icon" className="icon-button" onClick={onDismissError} aria-label="Dismiss error"><X size={14} /></Button></div>}</div>
      {view.loading ? <div className="conversation-loading" role="status" aria-busy="true"><div className="runtime-notice"><StatusDot kind="running" label="Loading conversation…" /></div>
        <SkeletonGroup motion="lockstep"><Skeleton style={{ width: '54%', height: 28, marginLeft: 'auto' }} />
          <Skeleton style={{ width: '92%', marginTop: 28 }} /><Skeleton style={{ width: '84%', marginTop: 10 }} /><Skeleton style={{ width: '67%', marginTop: 10 }} /></SkeletonGroup>
      </div> : hasMessages
        ? <div className={`conversation-region ${cards ? 'has-rail' : ''}`}><ConversationView view={view} cards={cards} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} /></div>
        : <NewSessionHome view={view} client={client} />}
      {showTerminal && terminalOpen && view.activeSession?.workspace && <TerminalPanel client={client} workspaceId={view.activeSession.workspace.id} onClose={onCloseTerminal} onError={onReportError} />}
      <div className="composer-slot is-docked">
        <div className="composer-column">
          <PromptComposer view={view} client={client} onChooseProject={onChooseProject} onSend={onSend} onAbort={onAbort} onSetApproval={onSetApproval} onSetModel={onSetModel} onSetThinking={onSetThinking} onOpenDetails={onOpenDetails} pending={pending} awaitingInput={awaitingInput} />
        </div>
      </div>
    </div>
  </main>;
}

/** Home activity shares the new-session content column. */
function NewSessionHome({ view, client }: { view: DesktopView; client: WsClient }) {
  return <div className="landing-stage">
    <div className="home-overview">
      <h1 className="home-greeting"><span>What’s up next?</span></h1>
      <HomeUsage client={client} connection={view.connection} booting={view.booting} />
    </div>
  </div>;
}

/** Scroll offsets survive switching sessions; the conversation unmounts while an empty session is shown. */
const conversationPositions = new Map<string, { top: number; pinned: boolean }>();

/*
 * Adapted from Caho1/open-claude-ui, code-examples/useClaudeScrollPinning.ts,
 * MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85. Thresholds and the
 * gesture cooldown live in ./scroll-follow so they can be tested without a DOM.
 */
const SCROLL_FADE_SIZE = 28;

function ConversationView({ view, cards, onOpenFile, onOpenExternal }: { view: DesktopView; cards?: ReactNode; onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastGesture = useRef(0);
  const viewport = useRef({ width: 0, height: 0 });
  const [showJump, setShowJump] = useState(false);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const messages = view.activeSession?.messages ?? [];
  const tools = view.activeSession?.tools ?? [];
  const sessionId = view.activeSession?.session.sessionId ?? '';
  const nativeResults = new Map(messages.filter(message => message.role === 'toolResult' && message.toolCallId).map(message => [message.toolCallId!, toolResultActivity(message)]));
  const messageToolIds = new Set(messages.flatMap(message => message.content.flatMap(content => content.type === 'toolCall' ? [content.id] : [])));
  const liveTools = new Map(tools.map(tool => [tool.id, tool]));
  for (const [id, result] of nativeResults) liveTools.set(id, { ...liveTools.get(id), ...result, arguments: liveTools.get(id)?.arguments ?? result.arguments });
  const nativeResultIds = new Set(nativeResults.keys());
  /** One timeline per turn, owned by its last text-bearing assistant message. */
  const turnMeta = turnMetaIndexes(messages);
  /** Both edge fades stay dormant at the matching edge; only the clipped side feathers. */
  const syncFades = (element: HTMLElement) => {
    const top = element.scrollTop > 2;
    const bottom = distanceFromBottom(element) > 2;
    setFade(current => current.top === top && current.bottom === bottom ? current : { top, bottom });
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldFollow(pinned.current, lastGesture.current, performance.now())) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, tools, view.runtime.status]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !sessionId) return;
    const saved = conversationPositions.get(sessionId);
    pinned.current = saved?.pinned ?? true;
    lastGesture.current = 0;
    el.scrollTop = pinned.current ? el.scrollHeight : saved?.top ?? el.scrollHeight;
    setShowJump(showsJump(distanceFromBottom(el)));
    syncFades(el);
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
    // Font swaps and preview resizes change the content height without a message update.
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);
  const markGesture = () => { lastGesture.current = performance.now(); };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const resized = viewport.current.width !== el.clientWidth || viewport.current.height !== el.clientHeight;
    if (resized && pinned.current) el.scrollTop = el.scrollHeight;
    viewport.current = { width: el.clientWidth, height: el.clientHeight };
    const distance = distanceFromBottom(el);
    pinned.current = isPinned(distance);
    if (sessionId) conversationPositions.set(sessionId, { top: el.scrollTop, pinned: pinned.current });
    setShowJump(showsJump(distance));
    syncFades(el);
  };
  return <>
    <div className="conversation-scroll" ref={scrollRef} onScroll={onScroll} onWheel={markGesture} onTouchStart={markGesture} onKeyDown={markGesture} aria-label="Conversation">
      <div className={`conversation-flow ${cards ? 'has-rail' : ''}`}>
        <div className="conversation-column" ref={contentRef}>
          {messages.map((message, index) => <MessageRow key={`${message.timestamp}-${index}`} message={message} tools={liveTools} messageToolIds={messageToolIds} thinkingLive={!!view.activeSession?.streaming && index === messages.length - 1} showMeta={message.role === 'user' || turnMeta.has(index)} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} />)}
          {tools.filter(tool => !messageToolIds.has(tool.id) && !nativeResultIds.has(tool.id)).map(tool => <ToolCard key={tool.id} tool={tool} onOpenFile={onOpenFile} />)}
          {view.runtime.status === 'failed' && <div className="runtime-notice error"><WarningCircle size={15} /><span>{view.runtime.detail ?? 'The last turn failed.'}</span></div>}
          {view.runtime.status === 'offline' && <div className="runtime-notice error"><WarningCircle size={15} /><span>{view.runtime.detail ?? 'Disconnected from the local server.'} The transcript is read-only until it reconnects.</span></div>}
          {view.runtime.status === 'stop-requested' && <div className="runtime-notice"><CircleNotch className="spin" size={15} /><span>Stop requested. Waiting for Pi to settle the session…</span></div>}
          {view.runtime.status === 'working' && <div className="stream-indicator"><span /><span /><span />Generating</div>}
        </div>
        {cards && <div className="information-rail"><div className="information-rail-sticky">{cards}</div></div>}
      </div>
    </div>
    {showJump && <Button variant="ghost" size="icon" className="jump-latest" aria-label="Jump to latest" title="Jump to latest" onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; pinned.current = true; setShowJump(false); }}><ArrowDown size={15} /></Button>}
    <div className="conversation-fade top" style={{ height: fade.top ? SCROLL_FADE_SIZE : 0 }} aria-hidden="true" />
    <div className="conversation-fade bottom" style={{ height: fade.bottom ? SCROLL_FADE_SIZE : 0 }} aria-hidden="true" />
  </>;
}

type MessageGroup =
  | { kind: 'tools'; items: Extract<UiContent, { type: 'toolCall' }>[] }
  | { kind: 'images'; items: Extract<UiContent, { type: 'image' }>[] }
  | { kind: 'single'; content: UiContent };

function MessageRow({ message, tools, messageToolIds, thinkingLive, showMeta, onOpenFile, onOpenExternal }: { message: UiMessage; tools: Map<string, UiToolActivity>; messageToolIds: Set<string>; thinkingLive: boolean; showMeta: boolean; onOpenFile: (path: string) => void; onOpenExternal: (url: string) => void }) {
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
  const plainText = message.content.map(part => part.type === 'text' ? part.text : '').filter(Boolean).join('\n\n');
  return <article className={`message ${message.role}`}>
    {message.role === 'user'
      ? <UserMessageBubble timestamp={message.timestamp} plainText={plainText}>{content}</UserMessageBubble>
      : <AssistantMessage timestamp={message.timestamp} plainText={plainText} showMeta={showMeta}>{content}</AssistantMessage>}
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
  const layer = useRef<HTMLDivElement>(null);
  const textEntry = request.kind === 'input' || request.kind === 'editor';
  useModalFocus(layer, {
    initialFocusSelector: textEntry ? 'input, textarea' : undefined,
    fallbackFocusSelector: '[aria-label="Message Aster"]',
  });
  return <div className="modal-scrim" ref={layer} onMouseDown={event => { if (event.target === event.currentTarget && !pending) onReply(null); }}>
    <form className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="extension-dialog-title"
      onKeyDown={event => { if (event.key === 'Escape' && !pending && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); onReply(null); } }}
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
