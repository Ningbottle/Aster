import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';

const COPY_FEEDBACK_MS = 2500;

/**
 * Clipboard action with a visible failure state. A rejected write must not look
 * like a successful copy that silently reverted; the callers place the returned
 * span next to the control.
 */
export function CopyButton({ text, label, className = '', iconSize = 13 }: {
  text: string;
  label: string;
  className?: string;
  iconSize?: number;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const resetLater = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
  };
  const copy = () => {
    if (!text) return;
    if (!navigator.clipboard) { setState('failed'); resetLater(); return; }
    void navigator.clipboard.writeText(text).then(
      () => { setState('copied'); resetLater(); },
      () => { setState('failed'); resetLater(); },
    );
  };
  return <>
    <button type="button" className={`copy-action ${className}`} onClick={copy}
      title={state === 'copied' ? 'Copied' : label} aria-label={state === 'copied' ? 'Copied' : label}>
      {state === 'copied' ? <Check size={iconSize} /> : <Copy size={iconSize} />}
    </button>
    {state === 'failed' && <span className="copy-error" role="status">Copy failed</span>}
  </>;
}
