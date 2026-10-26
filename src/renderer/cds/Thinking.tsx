/* Adapted from Caho1/open-claude-ui, code-examples/ThinkingAccordion.tsx, MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85. */
import { useEffect, useId, useRef, useState } from 'react';
import { CaretDown, Check, Copy } from '@phosphor-icons/react';

export interface ThinkingAccordionProps {
  thoughtText: string;
  isThinkingLive: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

export function ThinkingAccordion({ thoughtText, isThinkingLive, defaultExpanded = true, className = '' }: ThinkingAccordionProps) {
  const [userExpanded, setUserExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentId = useId();
  const isOpen = isThinkingLive || userExpanded;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!thoughtText.trim() && !isThinkingLive) return null;

  function copyThought() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(thoughtText).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    }, () => setCopied(false));
  }

  return (
    <div data-cds="ThinkingAccordion" className={`thinking-accordion ${className}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        aria-disabled={isThinkingLive || undefined}
        onClick={() => { if (!isThinkingLive) setUserExpanded(open => !open); }}
        className={`thinking-trigger ${isThinkingLive ? 'is-live' : ''}`}
      >
        {isThinkingLive ? <span className="timeline-quiet-dots" aria-hidden="true"><span /><span /><span /></span> : <span className="thinking-dot" aria-hidden="true" />}
        <span className="thinking-label">{isThinkingLive ? 'Thinking…' : 'Thought process'}</span>
        <CaretDown aria-hidden="true" size={12} className={`thinking-chevron ${isOpen ? 'is-open' : ''}`} />
      </button>
      <div id={contentId} className="thinking-collapse" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}>
        <div className="thinking-clip">
          <div className="thinking-body">
            <div className="thinking-text">{thoughtText}</div>
            <button type="button" className="thinking-copy icon-button" aria-label={copied ? 'Thought copied' : 'Copy thought'} title={copied ? 'Copied' : 'Copy thought'} onClick={copyThought}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
