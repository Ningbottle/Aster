import { useEffect, useRef } from 'react';
import { CaretDown, FolderSimple, X } from '@phosphor-icons/react';
import type { UiMessage } from './model';
import type { DesktopView } from './desktop-state';
import { CdsButton as Button } from './cds/Button';
import { ContextRing } from './ContextRing';
import { FileIcon } from './FileIcon';
import { ApiUsageRows, ContextUsageMeter } from './UsageCard';
import { contextWindowUsage } from './usage';
import type { WsClient } from './client';
import { TodoSection } from './TodoSection';

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

const baseName = (path: string) => path.replaceAll('\\', '/').split('/').pop() || path;

export function SessionDetails({ view, client, onClose, onOpenFile, focusContext = 0 }: {
  view: DesktopView;
  client: WsClient;
  onClose: () => void;
  onOpenFile: (path: string) => void;
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
    <details className="info-card context-card" open ref={contextCard}>
      <summary>
        <span>Context</span>
        <CaretDown className="summary-caret" size={10} />
        <span className="context-summary-metrics">
          <ContextRing usage={usage} size={11} decorative />
          <span>{usage.percentLabel ?? '—'}</span>
        </span>
      </summary>
      <ContextUsageMeter usage={usage} />
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
          <button type="button" className="output-row" title={`Open ${path}`} onClick={() => onOpenFile(path)}>
            <FileIcon path={path} size={14} />
            <span>{baseName(path)}</span>
          </button>
        </li>)}</ul>
        : <p className="detail-subtle">No files written in this session.</p>}
    </details>
    {active && workspace && <TodoSection key={`${workspace.id}:${active.session.sessionId}`} client={client} workspaceId={workspace.id} sessionId={active.session.sessionId} connection={view.connection} />}
  </aside>;
}
