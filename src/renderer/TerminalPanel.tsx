import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  INITIAL_TERMINAL_TAB_KEY,
  WS_CHANNELS,
  type TerminalDataPush,
  type TerminalExitPush,
  type TerminalTabInfo,
} from '@thinkrail/contracts';
import type { WsClient } from './client';
import { CdsButton as Button } from './cds/Button';

type TerminalState = 'attaching' | 'ready' | 'exited' | 'failed';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A real terminal on the ThinkRail contract. The panel attaches to the workspace's
 * initial terminal tab; closing the panel only detaches the view, it does not kill the shell.
 */
export function TerminalPanel({ client, workspaceId, onClose, onError }: {
  client: WsClient;
  workspaceId: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TerminalState>('attaching');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const reportError = useRef(onError);
  reportError.current = onError;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let terminalId: string | null = null;
    let buffered: TerminalDataPush[] = [];
    let unsubscribeData = () => {};
    let unsubscribeExit = () => {};
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 12.5,
      lineHeight: 1.35,
      scrollback: 5_000,
      screenReaderMode: true,
      fontFamily: 'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, monospace',
      theme: {
        background: '#27231d',
        foreground: '#e8e2d6',
        cursor: '#c96442',
        cursorAccent: '#27231d',
        selectionBackground: '#4b4236',
        black: '#27231d',
        red: '#d9776a',
        green: '#8fae7e',
        yellow: '#d8b46a',
        blue: '#7f9fbd',
        magenta: '#b08aa8',
        cyan: '#7fa8a3',
        white: '#e8e2d6',
        brightBlack: '#8d8577',
        brightRed: '#e39084',
        brightGreen: '#a5c094',
        brightYellow: '#e6c783',
        brightBlue: '#97b4cf',
        brightMagenta: '#c5a2bd',
        brightCyan: '#97bdb8',
        brightWhite: '#f5f0e7',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    terminal.focus();
    setStatus('attaching');
    setExitCode(null);

    unsubscribeData = client.subscribe(WS_CHANNELS.terminalData, data => {
      const push = data as TerminalDataPush;
      if (typeof push?.id !== 'string' || typeof push.data !== 'string') return;
      if (terminalId === null) { buffered.push(push); return; }
      if (push.id !== terminalId) return;
      terminal.write(push.data);
    });
    unsubscribeExit = client.subscribe(WS_CHANNELS.terminalExit, data => {
      const push = data as TerminalExitPush;
      if (typeof push?.id !== 'string' || push.id !== terminalId) return;
      terminalId = null;
      setStatus('exited');
      setExitCode(typeof push.exitCode === 'number' ? push.exitCode : null);
    });
    const input = terminal.onData(data => {
      if (!terminalId) return;
      void client.request('terminal.write', { id: terminalId, data }).catch(error => reportError.current(errorMessage(error)));
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (!terminalId) return;
      void client.request('terminal.resize', { id: terminalId, cols, rows }).catch(error => reportError.current(errorMessage(error)));
    });
    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* the element can be hidden while the panel closes */ }
    });
    observer.observe(element);

    void (async () => {
      try {
        const listed = await client.request('terminal.list', { workspaceId });
        let tabs: TerminalTabInfo[] = listed.tabs;
        if (!tabs.length) {
          const reserved = await client.request('terminal.reserve', {
            workspaceId, tabKey: INITIAL_TERMINAL_TAB_KEY, title: 'Terminal 1',
          });
          tabs = [reserved.tab];
        }
        if (disposed) return;
        const tab = tabs[0];
        const attached = await client.request('terminal.attach', {
          workspaceId, tabKey: tab.tabKey, title: tab.title, cols: terminal.cols, rows: terminal.rows,
        });
        if (disposed) return;
        terminalId = attached.id;
        if (attached.replay) terminal.write(attached.replay);
        for (const push of buffered) if (push.id === terminalId) terminal.write(push.data);
        buffered = [];
        setStatus('ready');
        terminal.focus();
      } catch (error) {
        if (disposed) return;
        const message = errorMessage(error);
        setStatus('failed');
        terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
        reportError.current(message);
      }
    })();

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resize.dispose();
      unsubscribeData();
      unsubscribeExit();
      terminal.dispose();
    };
  }, [client, workspaceId]);

  return <section className="terminal-drawer" aria-label="Terminal">
    <header className="terminal-head">
      <span className="terminal-title">Terminal</span>
      <span className={`terminal-status is-${status}`} role="status">
        {status === 'attaching' ? 'Connecting…' : status === 'failed' ? 'Unavailable'
          : status === 'exited' ? `Exited${exitCode === null ? '' : ` (${exitCode})`}` : 'Running'}
      </span>
      <Button variant="ghost" size="icon" className="icon-button" aria-label="Close terminal" title="Close terminal" onClick={onClose}><X size={14} /></Button>
    </header>
    <div className="terminal-body" ref={host} />
  </section>;
}
