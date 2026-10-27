/*
 * Adapted from Caho1/open-claude-ui, code-examples/EpitaxyIframeBridge.tsx, MIT,
 * commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * The sandbox drops allow-same-origin on purpose: the frame gets a null origin, so
 * previewed markup cannot reach the parent DOM, cookies or the native bridge.
 * It also drops allow-scripts: a workspace HTML file is untrusted input, and the
 * renderer CSP would block its inline scripts anyway.
 * Aster has no MCP app channel, so only runtime errors are forwarded.
 */
import { useCallback, useEffect, useRef } from 'react';

interface ArtifactMessage {
  channel?: string;
  type?: string;
  payload?: unknown;
}

export function ArtifactFrame({ html, title, onError }: {
  html: string;
  title: string;
  onError?: (error: unknown) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handleMessage = useCallback((event: MessageEvent) => {
    if (!frame.current || event.source !== frame.current.contentWindow) return;
    if (event.origin !== 'null' && event.origin !== window.location.origin) return;
    const data = event.data as ArtifactMessage | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'EPITAXY_RUNTIME_ERROR') onError?.(data.payload);
  }, [onError]);
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);
  if (!html) return null;
  return <iframe
    ref={frame}
    title={title}
    srcDoc={html}
    sandbox="allow-forms allow-popups allow-modals"
    referrerPolicy="strict-origin"
    allow="clipboard-write; fullscreen"
    className="artifact-frame"
  />;
}
