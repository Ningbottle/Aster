import { useEffect, useId, useRef, useState } from 'react';
import {
  CaretDown,
  CaretRight,
  Check,
  CircleNotch,
  Copy,
  MagnifyingGlass,
  TerminalWindow,
  WarningCircle,
  Wrench,
} from '@phosphor-icons/react';
import type { UiImage, UiToolActivity } from './model';
import { CdsButton as Button } from './cds/Button';
import { FileIcon } from './FileIcon';
import { ImageBlock } from './ImageAttachment';
import { diffForToolArgs, languageOf, normalizeToolName, splitRows, toolFilePath, type DiffHunk, type DiffLine, type LineDiff } from './diff';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function commandText(tool: UiToolActivity): string | undefined {
  const args = asRecord(tool.arguments);
  return typeof args?.command === 'string' ? args.command : undefined;
}

function safeJson(value: unknown): string {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value, null, 2);
  return encoded === undefined ? 'null' : encoded;
}

/** Tool results arrive as Pi's AgentToolResult: text content plus optional details. */
function outputText(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === 'string') return output || undefined;
  const record = asRecord(output);
  if (!record) return safeJson(output);
  if (Array.isArray(record.content)) {
    const text = record.content.map(part => {
      const item = asRecord(part);
      return item && item.type === 'text' && typeof item.text === 'string' ? item.text : '';
    }).filter(Boolean).join('\n');
    if (text) return text;
  }
  if (typeof record.output === 'string' && record.output) return record.output;
  if (typeof record.stdout === 'string' && record.stdout) return record.stdout;
  if (typeof record.text === 'string' && record.text) return record.text;
  return undefined;
}

/** Images carried by a live tool result's content array; transcript results attach them directly. */
function outputImages(output: unknown): UiImage[] {
  const record = asRecord(output);
  if (!record || !Array.isArray(record.content)) return [];
  return record.content.flatMap(part => {
    const item = asRecord(part);
    return item?.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string'
      ? [{ data: item.data, mimeType: item.mimeType }]
      : [];
  });
}

function toolImages(tool: UiToolActivity): UiImage[] {
  const images = [...(tool.images ?? []), ...outputImages(tool.output)];
  return images.filter((image, index) => images.findIndex(candidate => candidate.data === image.data) === index);
}

function toolStats(tool: UiToolActivity): LineDiff | null {
  if (tool.status !== 'succeeded') return null;
  return diffForToolArgs(tool.name, tool.arguments);
}

function StatBadge({ diff }: { diff: LineDiff | null }) {
  if (!diff || (!diff.additions && !diff.deletions)) return null;
  return <span className="tool-stat" aria-label={`${diff.additions} additions, ${diff.deletions} deletions`}>
    {diff.additions > 0 && <span className="stat-add">+{diff.additions}</span>}
    {diff.deletions > 0 && <span className="stat-del">−{diff.deletions}</span>}
  </span>;
}

function ToolGlyph({ tool, path }: { tool: UiToolActivity; path?: string }) {
  if (tool.status === 'running') return <CircleNotch className="spin" size={15} aria-label="Running" />;
  if (tool.status === 'failed') return <WarningCircle className="tool-failed" size={15} aria-label="Failed" />;
  if (path) return <FileIcon path={path} size={15} />;
  if (normalizeToolName(tool.name) === 'bash') return <TerminalWindow size={15} />;
  if (['grep', 'search', 'web_search'].includes(normalizeToolName(tool.name))) return <MagnifyingGlass size={15} />;
  return <Wrench size={15} />;
}

function summaryLabel(tool: UiToolActivity, path: string | undefined) {
  switch (normalizeToolName(tool.name)) {
    case 'read': return path ? 'Read' : 'Read file';
    case 'edit': return path ? 'Edited' : 'Edited file';
    case 'write': return path ? 'Wrote' : 'Wrote file';
    case 'bash': return 'Ran command';
    case 'grep': return 'Searched';
    case 'glob': return 'Found files';
    case 'list':
    case 'ls': return 'Listed';
    case 'task': return 'Ran task';
    case 'web_fetch': return 'Fetched';
    case 'web_search': return 'Searched the web';
    default: return tool.name;
  }
}

function DiffCard({ path, diff, onOpenFile }: { path: string; diff: LineDiff; onOpenFile?: (path: string) => void }) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function copyDiff() {
    if (!navigator.clipboard) return;
    const text = diff.hunks.map(hunk => [
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      ...hunk.lines.map(line => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`),
    ].join('\n')).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    }, () => setCopied(false));
  }
  const language = languageOf(path);
  /** Split only helps when a line was removed; a pure write has nothing to compare. */
  const canSplit = diff.additions > 0 && diff.deletions > 0;
  return <div className="diff-card">
    <div className="diff-card-head">
      <FileIcon path={path} size={14} />
      {onOpenFile
        ? <button type="button" className="diff-card-path" title={`Open ${path}`} onClick={() => onOpenFile(path)}>{path}</button>
        : <span className="diff-card-path" title={path}>{path}</span>}
      {language && <span className="diff-lang">{language}</span>}
      <span className="diff-counts"><span className="add">+{diff.additions}</span><span className="del">-{diff.deletions}</span></span>
      <div className="diff-modes" role="group" aria-label="Diff view">
        <button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>Unified</button>
        {canSplit && <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>Split</button>}
      </div>
      <Button variant="ghost" size="icon" className="diff-copy" aria-label={copied ? 'Diff copied' : 'Copy diff'} title={copied ? 'Copied' : 'Copy diff'} onClick={copyDiff}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
    <div className="diff-scroll">
      {diff.hunks.map((hunk, index) => <DiffHunkView hunk={hunk} mode={canSplit ? mode : 'unified'} key={index} />)}
    </div>
  </div>;
}

function DiffHunkView({ hunk, mode }: { hunk: DiffHunk; mode: 'unified' | 'split' }) {
  const rows = mode === 'split' ? splitRows(hunk.lines) : null;
  return <div className="diff-hunk">
    <div className="diff-hunk-head">@@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@</div>
    {rows
      ? <div className="diff-split">
        <table className="diff-table diff-side"><tbody>{rows.map((row, index) => <DiffRow line={row.left} key={index} />)}</tbody></table>
        <table className="diff-table diff-side"><tbody>{rows.map((row, index) => <DiffRow line={row.right} key={index} />)}</tbody></table>
      </div>
      : <table className="diff-table"><tbody>{hunk.lines.map((line, index) => <DiffRow line={line} key={index} />)}</tbody></table>}
  </div>;
}

/** Two gutters keep added and removed line numbers aligned with the source. */
function DiffRow({ line }: { line: DiffLine | null }) {
  if (!line) return <tr className="diff-row blank"><td className="diff-num" /><td className="diff-num" /><td className="diff-mark" /><td className="diff-code" /></tr>;
  return <tr className={`diff-row ${line.kind}`}>
    <td className="diff-num">{line.oldNumber ?? ''}</td>
    <td className="diff-num">{line.newNumber ?? ''}</td>
    <td className="diff-mark" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</td>
    <td className="diff-code">{line.text || ' '}</td>
  </tr>;
}

function GenericDetail({ tool, path }: { tool: UiToolActivity; path?: string }) {
  const command = commandText(tool);
  const output = outputText(tool.output);
  const images = toolImages(tool);
  if (normalizeToolName(tool.name) === 'bash' && command) {
    return <div className="bash-card">
      <div className="bash-head"><TerminalWindow size={14} /><span>bash</span>{path && <span className="bash-cwd">{path}</span>}</div>
      <pre className="bash-command"><span aria-hidden="true">$ </span>{command}</pre>
      {output && <pre className="bash-output">{output}</pre>}
      {images.length > 0 && <ImageBlock images={images} />}
    </div>;
  }
  return <div className="tool-detail">
    {tool.arguments !== null && tool.arguments !== undefined && <div><span>Arguments</span><pre>{safeJson(tool.arguments)}</pre></div>}
    {(output !== undefined || images.length > 0) && <div><span>Result</span>
      {output !== undefined && <pre>{output}</pre>}
      {images.length > 0 && <ImageBlock images={images} />}
    </div>}
    {output === undefined && images.length === 0 && tool.status === 'unknown' && <div className="tool-unknown">No final result was observed for this tool.</div>}
    {output === undefined && images.length === 0 && tool.status === 'running' && <div className="tool-unknown">Still running.</div>}
  </div>;
}

export function ToolCard({ tool, initialOpen, onOpenFile }: { tool: UiToolActivity; initialOpen?: boolean; onOpenFile?: (path: string) => void }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(initialOpen === undefined ? null : initialOpen);
  const detailId = useId();
  const path = toolFilePath(tool.arguments);
  const command = commandText(tool);
  const diff = toolStats(tool);
  const hasDiff = !!diff && (diff.additions > 0 || diff.deletions > 0);
  const open = userOpen ?? hasDiff;
  const label = summaryLabel(tool, path);
  return <section className={`tool-card ${tool.status}`} aria-busy={tool.status === 'running'}>
    <Button variant="ghost" size="xs" className="tool-summary" onClick={() => setUserOpen(!open)} aria-expanded={open} aria-controls={detailId}>
      <ToolGlyph tool={tool} path={path} />
      <span className="tool-label">{label}</span>
      {path && normalizeToolName(tool.name) !== 'bash' && <span className="tool-path" title={path}>{path}</span>}
      {command && <span className="tool-path tool-command" title={command}>{command}</span>}
      <StatBadge diff={diff} />
      {tool.status === 'failed' && <span className="tool-status">Failed</span>}
      {tool.status === 'unknown' && <span className="tool-status">Result unknown</span>}
      <span className="tool-chevron" aria-hidden="true">{open ? <CaretDown size={13} /> : <CaretRight size={13} />}</span>
    </Button>
    {open && <div id={detailId} role="region" aria-label={`${label} details`}>
      {hasDiff && path ? <DiffCard path={path} diff={diff} onOpenFile={onOpenFile} /> : <GenericDetail tool={tool} path={path} />}
    </div>}
  </section>;
}

function groupCountLabel(tools: UiToolActivity[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const name = normalizeToolName(tool.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [name, count] of counts) {
    if (name === 'read') parts.push(count === 1 ? 'Read 1 file' : `Read ${count} files`);
    else if (name === 'edit') parts.push(count === 1 ? 'Edited 1 file' : `Edited ${count} files`);
    else if (name === 'write') parts.push(count === 1 ? 'Wrote 1 file' : `Wrote ${count} files`);
    else if (name === 'bash') parts.push(`Ran ${count} command${count === 1 ? '' : 's'}`);
    else if (name === 'grep') parts.push(`Searched ${count} time${count === 1 ? '' : 's'}`);
    else parts.push(`${name} × ${count}`);
  }
  return parts.join(', ');
}

export function ToolGroup({ tools, onOpenFile }: { tools: UiToolActivity[]; onOpenFile?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  if (tools.length === 1) return <ToolCard tool={tools[0]} onOpenFile={onOpenFile} />;
  const failed = tools.some(tool => tool.status === 'failed');
  const running = tools.some(tool => tool.status === 'running');
  const unknown = tools.some(tool => tool.status === 'unknown');
  const readsOnly = tools.every(tool => normalizeToolName(tool.name) === 'read');
  const readCount = new Set(tools.map(tool => toolFilePath(tool.arguments)).filter((path): path is string => !!path)).size || tools.length;
  const stats = tools.reduce<LineDiff>((total, tool) => {
    const diff = toolStats(tool);
    return diff
      ? { hunks: total.hunks, additions: total.additions + diff.additions, deletions: total.deletions + diff.deletions }
      : total;
  }, { hunks: [], additions: 0, deletions: 0 });
  return <section className={`activity-group ${failed ? 'failed' : ''}`} aria-busy={running}>
    <Button variant="ghost" size="xs" className="activity-summary" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>
      {running && <CircleNotch size={14} className="spin" aria-label="Running" />}
      <span className="activity-label">{readsOnly ? (readCount === 1 ? 'Read 1 file' : `Read ${readCount} files`) : groupCountLabel(tools)}</span>
      <StatBadge diff={stats} />
      {failed && <span className="activity-state">Failed</span>}
      {unknown && <span className="activity-state">Result unknown</span>}
      <span className="tool-chevron" aria-hidden="true">{expanded ? <CaretDown size={13} /> : <CaretRight size={13} />}</span>
    </Button>
    {expanded && <div id={detailId} className="activity-tools" role="region" aria-label="Tool activity details">{tools.map(tool => <ToolCard key={tool.id} tool={tool} onOpenFile={onOpenFile} />)}</div>}
  </section>;
}
