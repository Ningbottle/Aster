/* Adapted from Caho1/open-claude-ui, code-examples/ChatMessageBubbles.tsx, MIT,
 * commit c1f923ae0051a871941b98a0e2e3183a545e6a85. Kept: the bubble container,
 * the long-message reading mask and the hover/focus action row. Removed: the
 * demo timestamp, model name, avatar and fabricated delivery state. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { formatAbsoluteTime, formatIsoTime, formatRelativeTime } from '../message-time';

const COLLAPSE_HEIGHT = 300;

export interface MessageContainerProps {
  children: ReactNode;
  id?: string | number;
}

function useTransientCopy(text: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const resetLater = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2500);
  };
  const copy = () => {
    if (!text) return;
    if (!navigator.clipboard) { setState('failed'); resetLater(); return; }
    void navigator.clipboard.writeText(text).then(() => { setState('copied'); resetLater(); }, () => { setState('failed'); resetLater(); });
  };
  return { state, copy };
}

/** Relative time plus a copy action; both derive from the real transcript. */
export function MessageMeta({ timestamp, text, align }: { timestamp?: number; text: string; align: 'start' | 'end' }) {
  const { state, copy } = useTransientCopy(text);
  const relative = timestamp === undefined ? null : formatRelativeTime(timestamp);
  const absolute = timestamp === undefined ? null : formatAbsoluteTime(timestamp);
  const iso = timestamp === undefined ? null : formatIsoTime(timestamp);
  if (!relative && !text) return null;
  return <div className={`message-meta ${align === 'end' ? 'is-user' : 'is-assistant'}`}>
    {relative && <time dateTime={iso ?? undefined} title={absolute ?? undefined}>{relative}</time>}
    {text && <div className="message-actions" role="toolbar" aria-label="Message actions">
      <button type="button" className="message-action icon-button" title={state === 'copied' ? 'Copied' : 'Copy message'}
        aria-label={state === 'copied' ? 'Message copied' : 'Copy message'} onClick={copy}>
        {state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {state === 'failed' && <span className="message-copy-error" role="status">Copy failed</span>}
    </div>}
  </div>;
}

export function UserMessageBubble({ children, id, timestamp, plainText }: MessageContainerProps & { timestamp?: number; plainText: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  /** Measures the unclipped body so expand/collapse never feeds back into itself. */
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > COLLAPSE_HEIGHT + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);
  /** Keeps the message's top edge fixed while its clipped body changes height. */
  const toggleExpanded = () => {
    const row = body.current?.closest<HTMLElement>('.user-message-row');
    const scroller = row?.closest<HTMLElement>('.conversation-scroll');
    const before = row?.getBoundingClientRect().top;
    const wasPinned = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 40
      : false;
    setExpanded(value => !value);
    if (!row || !scroller || before === undefined) return;
    requestAnimationFrame(() => {
      if (wasPinned) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      const after = row.getBoundingClientRect().top;
      scroller.scrollTop += after - before;
    });
  };
  const clipped = overflowing && !expanded;
  return (
    <div id={id === undefined ? undefined : String(id)} data-cds="UserMessage" className="user-message-row">
      <div className="user-message-stack">
        <div className="user-message-bubble">
          <div className={`user-message-clip ${clipped ? 'is-clipped' : ''}`}>
            <div className="user-message-body" ref={body}>{children}</div>
          </div>
          {overflowing && <button type="button" className="message-expand" aria-expanded={expanded}
            onClick={toggleExpanded}>{expanded ? 'Show less' : 'Show more'}</button>}
        </div>
        <MessageMeta timestamp={timestamp} text={plainText} align="end" />
      </div>
    </div>
  );
}

export function AssistantMessage({ children, id, timestamp, plainText, showMeta = true }: MessageContainerProps & { timestamp?: number; plainText: string; showMeta?: boolean }) {
  return (
    <div id={id === undefined ? undefined : String(id)} data-cds="AssistantMessage" className="assistant-message">
      {/* Body and meta are separate slots: a tool-only turn has no body-level footer,
          and spacing rules can key on the body's last real block. */}
      <div className="assistant-body">{children}</div>
      {showMeta && plainText !== '' && <MessageMeta timestamp={timestamp} text={plainText} align="start" />}
    </div>
  );
}
