import { useEffect, useRef, useState } from 'react';
import { CaretDown, FolderSimple, X } from '@phosphor-icons/react';
import type { UiMessage } from './model';
import type { DesktopView } from './desktop-state';
import { CdsButton as Button } from './cds/Button';
import { ArtifactFrame } from './cds/ArtifactFrame';
import { ContextRing } from './ContextRing';
import { FileIcon } from './FileIcon';
import { needsBinary, previewKind, type PreviewKind } from './preview-kind';
import { PdfPreview } from './PdfPreview';
import { RichText } from './RichText';
import { ApiUsageRows, ContextUsageMeter } from './UsageCard';
import { contextWindowUsage } from './usage';
import type { WsClient } from './client';
import { TodoSection } from './TodoSection';

/** Preview caps keep a large generated file readable without freezing the panel. */
const PREVIEW_LIMIT = 120_000;

interface PreviewState {
  path: string;
  kind: PreviewKind;
  text?: string;
  data?: string;
  mime?: string;
  byteLength: number | null;
}

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

export function SessionDetails({ view, client, onClose, onOpenFile, onOpenExternal, previewPath, onPreviewPath, focusContext = 0 }: {
  view: DesktopView;
  client: WsClient;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenExternal?: (url: string) => void;
  /** File the panel is previewing; links and Outputs both raise it through the app. */
  previewPath: string | null;
  onPreviewPath: (path: string | null) => void;
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
  const workspaceId = workspace?.id ?? null;
  const contextCard = useRef<HTMLDetailsElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** A different path is loading; keep the old bytes out of the new header. */
  const ready = preview && preview.path === previewPath ? preview : null;
  /** Images and PDFs come back as base64; text files keep their own read path. */
  useEffect(() => {
    if (!previewPath || !workspaceId) { setPreview(null); setPreviewError(null); return; }
    let active = true;
    setPreviewError(null);
    const path = previewPath;
    const load = needsBinary(path)
      ? client.request('fs.readBinary', { workspaceId, path }).then(result => ({
        path, kind: previewKind(path, false), data: result.data, mime: result.mime, byteLength: result.byteLength,
      } as PreviewState))
      : client.request('fs.readFile', { workspaceId, path }).then(result => ({
        path, kind: previewKind(path, result.meta.text), text: result.content, byteLength: result.meta.byteLength,
      } as PreviewState));
    void load.then(state => { if (active) setPreview(state); }, cause => {
      if (!active) return;
      setPreview(null);
      setPreviewError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [previewPath, workspaceId, client]);
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
          <button type="button" className="output-row" aria-pressed={previewPath === path} title={`Preview ${path}`}
            onClick={() => onPreviewPath(previewPath === path ? null : path)}>
            <FileIcon path={path} size={14} />
            <span>{baseName(path)}</span>
          </button>
        </li>)}</ul>
        : <p className="detail-subtle">No files written in this session.</p>}
      {previewError && <p className="detail-subtle output-error" role="alert">{previewError}</p>}
      {previewPath && !ready && !previewError && <p className="detail-subtle">Loading preview…</p>}
    </details>
    {ready && <section className="details-preview" aria-label={`Preview of ${ready.path}`}>
      <div className="details-preview-head">
        <FileIcon path={ready.path} size={14} />
        <span className="details-preview-path" title={ready.path}>{baseName(ready.path)}</span>
        <Button variant="ghost" size="xs" className="details-preview-open" onClick={() => onOpenFile(ready.path)}>Open</Button>
        <Button variant="ghost" size="icon" className="icon-button" aria-label="Close preview" onClick={() => onPreviewPath(null)}><X size={13} /></Button>
      </div>
      {ready.kind === 'image' && ready.data
        ? <img className="details-preview-image" src={`data:${ready.mime};base64,${ready.data}`} alt={baseName(ready.path)} />
        : ready.kind === 'pdf'
          ? ready.data
            ? <PdfPreview data={ready.data} />
            : <p className="detail-subtle details-preview-note">Preparing PDF…</p>
          : ready.kind === 'markdown'
            ? <div className="details-preview-markdown"><RichText text={(ready.text ?? '').slice(0, PREVIEW_LIMIT)} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} /></div>
            : ready.kind === 'html'
              ? <div className="details-preview-html"><ArtifactFrame html={ready.text ?? ''} title={ready.path} onError={cause => setPreviewError(String(cause))} /></div>
              : ready.kind === 'text'
                ? <pre className="details-preview-text">{(ready.text ?? '').slice(0, PREVIEW_LIMIT)}</pre>
                : <p className="detail-subtle details-preview-note">Binary file{ready.byteLength === null ? '' : ` · ${ready.byteLength.toLocaleString()} bytes`}.</p>}
      {ready.kind === 'text' && (ready.text?.length ?? 0) > PREVIEW_LIMIT && <p className="detail-footnote details-preview-note">Preview truncated at {Math.round(PREVIEW_LIMIT / 1000)}k characters.</p>}
    </section>}
    {active && workspace && <TodoSection key={`${workspace.id}:${active.session.sessionId}`} client={client} workspaceId={workspace.id} sessionId={active.session.sessionId} connection={view.connection} />}
  </aside>;
}
