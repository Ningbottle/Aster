import { useEffect, useRef } from 'react';
import { CaretDown, FolderSimple, X } from '@phosphor-icons/react';
import type { UiMessage } from './model';
import type { DesktopView } from './desktop-state';
import { CdsButton as Button } from './cds/Button';
import { FileIcon } from './FileIcon';
import { ApiUsageRows } from './UsageCard';
import { contextWindowUsage } from './usage';
import type { WsClient } from './client';
import { TodoSection } from './TodoSection';
import { baseName } from './path-display';

function outputPaths(messages: UiMessage[]) {
  const succeeded = new Set(messages.filter(message => message.role === 'toolResult' && !message.isError).map(message => message.toolCallId));
  const paths = new Set<string>();
  for (const message of messages) for (const part of message.content) {
    if (part.type !== 'toolCall' || !['write', 'edit'].includes(part.name) || !succeeded.has(part.id)) continue;
    const args = part.arguments;
    if (args && typeof args === 'object' && !Array.isArray(args) && 'path' in args && typeof args.path === 'string') paths.add(args.path);
  }
  return [...paths];
}

/** The card keeps one hairline bar like the reference; the detailed rows live under API usage. */
function ContextUsageBar({ usage }: { usage: ReturnType<typeof contextWindowUsage> }) {
  const percent = usage.percent === null ? 0 : Math.max(0, Math.min(100, usage.percent));
  return <div className="context-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage.percent ?? undefined} aria-label="Context window usage">
    <span style={{ width: `${percent}%` }} />
  </div>;
}

/**
 * Fixed-width information cards: Environment, Context, Outputs and the native
 * Todo list. The file viewer is a separate pane (FilePreview) and is never
 * opened or closed from here.
 */
export function SessionDetails({ view, client, onClose, onSelectOutput, selectedOutput, focusContext = 0 }: {
  view: DesktopView;
  client: WsClient;
  onClose: () => void;
  onSelectOutput: (path: string) => void;
  selectedOutput: string | null;
  /** Monotonic token from the composer card; 0 means no pending focus request. */
  focusContext?: number;
}) {
  const active = view.activeSession;
  const project = active?.project ?? null;
  const workspace = active?.workspace ?? null;
  const messages = active?.messages ?? [];
  const stats = active?.stats ?? null;
  const usage = contextWindowUsage(stats);
  const outputs = outputPaths(messages);
  const contextCard = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!focusContext) return;
    const card = contextCard.current;
    if (!card) return;
    card.open = true;
    card.querySelector('summary')?.focus();
    card.scrollIntoView({ block: 'nearest' });
  }, [focusContext]);
  return <aside className="details-panel" aria-label="Session information">
    <div className="details-close"><Button variant="ghost" size="icon" className="icon-button" aria-label="Close details" onClick={onClose}><X size={15} /></Button></div>
    <details className="info-card" open>
      <summary><span>Environment</span><CaretDown className="summary-caret" size={10} /></summary>
      {project
        ? <>
          <div className="info-row">
            <FolderSimple size={14} />
            <span className="info-row-text" title={project.path}>{project.name}</span>
          </div>
          {workspace && <div className="info-row" title={workspace.worktreePath}>
            <FolderSimple size={14} />
            <span className="info-row-text">{workspace.name}{workspace.branch ? ` · ${workspace.branch}` : ''}</span>
          </div>}
        </>
        : <p className="detail-subtle">Choose a project folder to begin.</p>}
    </details>
    <details className="info-card context-card" ref={contextCard}>
      <summary>
        <span>Context</span>
        <CaretDown className="summary-caret" size={10} />
        <span className="context-summary-metrics">
          <span>{usage.percentLabel ?? '—'}</span>
          <span className="context-mini" aria-hidden="true"><span style={{ width: `${usage.percent === null ? 0 : Math.max(0, Math.min(100, usage.percent))}%` }} /></span>
        </span>
      </summary>
      <ContextUsageBar usage={usage} />
      <details className="api-usage">
        <summary><CaretDown className="summary-caret" size={10} />API usage · session total</summary>
        <ApiUsageRows stats={stats} />
        <p className="detail-footnote">API usage totals this session, including turns before compaction. Context occupancy is a separate Pi session reading, not the same measure.</p>
      </details>
    </details>
    <details className="info-card" open>
      <summary><span>Outputs</span><CaretDown className="summary-caret" size={10} /></summary>
      {outputs.length
        ? <ul className="output-files">{outputs.map(path => <li key={path}>
          <button type="button" className="output-row" aria-pressed={selectedOutput === path} title={`Preview ${path}`}
            onClick={() => onSelectOutput(path)}>
            <FileIcon path={path} size={14} />
            <span>{baseName(path)}</span>
          </button>
        </li>)}</ul>
        : <p className="detail-subtle">No files written in this session.</p>}
    </details>
    {active && workspace && <TodoSection key={`${workspace.id}:${active.session.sessionId}`} client={client} workspaceId={workspace.id} sessionId={active.session.sessionId} connection={view.connection} />}
  </aside>;
}
