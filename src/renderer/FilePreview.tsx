import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowsOutSimple, Code as CodeIcon, Eye, X } from '@phosphor-icons/react';
import type { DesktopView } from './desktop-state';
import { ArtifactFrame } from './cds/ArtifactFrame';
import { CdsButton as Button } from './cds/Button';
import { CopyButton } from './CopyButton';
import { FileIcon } from './FileIcon';
import { needsBinary, previewKind, type PreviewKind } from './preview-kind';
import { PdfPreview } from './PdfPreview';
import { RichText } from './RichText';
import type { WsClient } from './client';
import { baseName } from './path-display';

/** Preview caps keep a large generated file readable without freezing the panel. */
const PREVIEW_LIMIT = 120_000;

interface PreviewIdentity {
  workspaceId: string;
  sessionId: string;
  path: string;
}

interface PreviewState extends PreviewIdentity {
  kind: PreviewKind;
  text?: string;
  data?: string;
  mime?: string;
  byteLength: number | null;
}

interface PreviewError extends PreviewIdentity {
  message: string;
}

/** Workspace-relative label; the full path stays in the tooltip. */
function displayPath(path: string, root: string | null): string {
  if (!root) return path;
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  const loweredPath = path.toLocaleLowerCase();
  if (!loweredPath.startsWith(normalizedRoot.toLocaleLowerCase())) return path;
  return path.slice(normalizedRoot.length).replace(/^[\\/]+/, '') || baseName(path);
}

/**
 * The file viewer is its own pane: it reads through the existing fs channels and
 * never relies on the information cards being visible. Bytes are bound to the
 * workspace, session and path that produced them so a late reply cannot leak
 * into another session. Tabs are the files actually opened in this pane.
 */
export function FilePreview({ view, client, paths, activePath, onSelect, onCloseTab, onClosePanel, onOpenFile, onOpenExternal }: {
  view: DesktopView;
  client: WsClient;
  paths: string[];
  activePath: string;
  onSelect: (path: string) => void;
  onCloseTab: (path: string) => void;
  onClosePanel: () => void;
  onOpenFile: (path: string) => void;
  onOpenExternal?: (url: string) => void;
}) {
  const active = view.activeSession;
  const workspaceId = active?.workspace?.id ?? null;
  const sessionId = active?.session.sessionId ?? null;
  const workspaceRoot = active?.workspace?.worktreePath ?? null;
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement | null>());
  /** Roving focus: only the active tab is tabbable, arrows walk the strip. */
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, path: string) => {
    const index = paths.indexOf(path);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0 && paths.length > 1) {
      event.preventDefault();
      const next = paths[(index + step + paths.length) % paths.length];
      onSelect(next);
      tabs.current.get(next)?.focus();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? paths[0] : paths[paths.length - 1];
      onSelect(next);
      tabs.current.get(next)?.focus();
    }
  };
  /** Per-file reading position; switching tabs must not lose the scroll offset. */
  const offsets = useRef(new Map<string, number>());
  const matchesSelection = (value: PreviewIdentity | null) => value !== null
    && value.workspaceId === workspaceId && value.sessionId === sessionId && value.path === activePath;
  const ready = preview && matchesSelection(preview) ? preview : null;
  const visibleError = previewError && matchesSelection(previewError) ? previewError.message : null;

  /** Images and PDFs come back as base64; text files keep their own read path. */
  useEffect(() => {
    if (!workspaceId || !sessionId) { setPreview(null); setPreviewError(null); return; }
    let current = true;
    setPreviewError(null);
    setSourceMode(false);
    const path = activePath;
    const load = needsBinary(path)
      ? client.request('fs.readBinary', { workspaceId, path }).then(result => ({
        workspaceId, sessionId, path, kind: previewKind(path, false), data: result.data, mime: result.mime, byteLength: result.byteLength,
      } as PreviewState))
      : client.request('fs.readFile', { workspaceId, path }).then(result => ({
        workspaceId, sessionId, path, kind: previewKind(path, result.meta.text), text: result.content, byteLength: result.meta.byteLength,
      } as PreviewState));
    void load.then(state => { if (current) setPreview(state); }, cause => {
      if (!current) return;
      setPreview(null);
      setPreviewError({ workspaceId, sessionId, path, message: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { current = false; };
  }, [activePath, workspaceId, sessionId, client]);

  /** Restore the reading position of the file that just became active. */
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    element.scrollTop = offsets.current.get(activePath) ?? 0;
  }, [activePath, ready]);

  const truncated = ready !== null && (ready.kind === 'text' || ready.kind === 'markdown') && (ready.text?.length ?? 0) > PREVIEW_LIMIT;
  const markdown = ready?.kind === 'markdown';
  /** A PDF carries its own toolbar (pages, zoom, open) so the path row would repeat it. */
  const pdf = ready?.kind === 'pdf';
  return <section className="preview-panel" aria-label={`Preview of ${activePath}`} data-workspace-preview={activePath}>
    <div className="preview-panel-head">
      <div className="preview-tabs" role="tablist" aria-label="Open files">
        {paths.map(path => <div key={path} className={`preview-tab ${path === activePath ? 'is-active' : ''}`}>
          <button type="button" role="tab" aria-selected={path === activePath} aria-controls="preview-panel-body"
            tabIndex={path === activePath ? 0 : -1} className="preview-tab-label"
            ref={element => { tabs.current.set(path, element); }}
            title={path} onClick={() => onSelect(path)} onKeyDown={event => onTabKeyDown(event, path)}>{baseName(path)}</button>
          <button type="button" className="preview-tab-close" aria-label={`Close ${baseName(path)}`} onClick={() => onCloseTab(path)}><X size={11} /></button>
        </div>)}
      </div>
      <Button variant="ghost" size="icon" className="icon-button" aria-label="Close preview" onClick={onClosePanel}><X size={13} /></Button>
    </div>
    {!pdf && <div className="preview-panel-path-row">
      <FileIcon path={activePath} size={13} />
      <span className="preview-panel-path" title={activePath}>{displayPath(activePath, workspaceRoot)}</span>
      <div className="preview-panel-actions">
        {markdown && <Button variant="ghost" size="icon" className="icon-button" aria-pressed={sourceMode}
          aria-label={sourceMode ? 'Show rendered Markdown' : 'Show Markdown source'} title={sourceMode ? 'Rendered' : 'Source'}
          onClick={() => setSourceMode(value => !value)}>{sourceMode ? <Eye size={14} /> : <CodeIcon size={14} />}</Button>}
        {ready?.text !== undefined && <CopyButton text={ready.text} label="Copy file content" className="icon-button" iconSize={13} />}
        <Button variant="ghost" size="icon" className="icon-button" aria-label="Open in the system editor" title="Open in the system editor"
          onClick={() => onOpenFile(activePath)}><ArrowsOutSimple size={14} /></Button>
      </div>
    </div>}
    <div className="preview-panel-body" id="preview-panel-body" role="tabpanel" aria-label={activePath} ref={body} onScroll={event => { offsets.current.set(activePath, event.currentTarget.scrollTop); }}>
      {visibleError
        ? <p className="detail-subtle output-error" role="alert">{visibleError}</p>
        : !ready
          ? <div className="preview-skeleton" role="status" aria-label="Loading preview">
              <span /><span /><span /><span />
            </div>
          : ready.kind === 'image' && ready.data
            ? <img className="details-preview-image" src={`data:${ready.mime};base64,${ready.data}`} alt={baseName(ready.path)} />
            : ready.kind === 'pdf'
              ? ready.data
                ? <PdfPreview data={ready.data} onOpenFile={() => onOpenFile(ready.path)} />
                : <p className="detail-subtle details-preview-note">Preparing PDF…</p>
              : ready.kind === 'markdown'
                ? sourceMode
                  ? <pre className="details-preview-text">{(ready.text ?? '').slice(0, PREVIEW_LIMIT)}</pre>
                  : <div className="details-preview-markdown"><RichText text={(ready.text ?? '').slice(0, PREVIEW_LIMIT)} onOpenFile={onOpenFile} onOpenExternal={onOpenExternal} /></div>
                : ready.kind === 'html'
                  ? <div className="details-preview-html"><ArtifactFrame html={ready.text ?? ''} title={ready.path} onError={cause => setPreviewError({ workspaceId: ready.workspaceId, sessionId: ready.sessionId, path: ready.path, message: String(cause) })} /></div>
                  : ready.kind === 'text'
                    ? <pre className="details-preview-text">{(ready.text ?? '').slice(0, PREVIEW_LIMIT)}</pre>
                    : <p className="detail-subtle details-preview-note">Binary file{ready.byteLength === null ? '' : ` · ${ready.byteLength.toLocaleString()} bytes`}.</p>}
    </div>
    {truncated && <p className="preview-panel-note" role="note">Preview truncated at {Math.round(PREVIEW_LIMIT / 1000)}k characters; the file on disk is unchanged.</p>}
  </section>;
}
