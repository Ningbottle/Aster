/**
 * Deterministic transcripts of tool activity for the collapsed rows. Nothing is
 * invented: verbs and file names come from the tool name and its real arguments,
 * and unknown tools keep their own name instead of being mapped to a read/write.
 */
import { normalizeToolName, toolFilePath } from './diff';
import { baseName } from './path-display';

export type ToolKind = 'read' | 'edit' | 'write' | 'bash' | 'search' | 'list' | 'task' | 'fetch' | 'other';

export interface SummaryInput {
  name: string;
  arguments: unknown;
}

export interface ToolSummary {
  /** Verb phrase without a file name, e.g. "Ran a command". */
  label: string;
  /** Basename when exactly one real path is involved. */
  file: string | null;
  /** Full path for the tooltip and for opening the file. */
  path: string | null;
}

export function toolKind(name: string): ToolKind {
  switch (normalizeToolName(name)) {
    case 'read': return 'read';
    case 'edit': return 'edit';
    case 'write': return 'write';
    case 'bash': return 'bash';
    case 'grep':
    case 'web_search': return 'search';
    case 'glob':
    case 'list':
    case 'ls': return 'list';
    case 'task': return 'task';
    case 'web_fetch': return 'fetch';
    default: return 'other';
  }
}

const LABELS: Record<ToolKind, string> = {
  read: 'Read',
  edit: 'Edited',
  write: 'Wrote',
  bash: 'Ran a command',
  search: 'Searched',
  list: 'Listed files',
  task: 'Ran a task',
  fetch: 'Fetched',
  other: '',
};

export function summarizeTool(tool: SummaryInput): ToolSummary {
  const kind = toolKind(tool.name);
  const path = kind === 'bash' ? null : toolFilePath(tool.arguments) ?? null;
  const label = kind === 'other' ? normalizeToolName(tool.name) : LABELS[kind];
  return { label, file: path ? baseName(path) : null, path };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : `${count} ${many}`;
}

/**
 * One readable phrase per operation kind. A single real path is named; several
 * paths (including equal basenames in different folders) fall back to a count so
 * the row never claims more or less than it can prove.
 */
export function summarizeTools(tools: SummaryInput[]): string {
  const groups = new Map<ToolKind, { count: number; paths: Set<string>; name: string }>();
  for (const tool of tools) {
    const kind = toolKind(tool.name);
    const entry = groups.get(kind) ?? { count: 0, paths: new Set<string>(), name: normalizeToolName(tool.name) };
    entry.count += 1;
    const path = kind === 'bash' ? null : toolFilePath(tool.arguments);
    if (path) entry.paths.add(path);
    groups.set(kind, entry);
  }
  const parts: string[] = [];
  const order: ToolKind[] = ['read', 'edit', 'write', 'bash', 'search', 'list', 'task', 'fetch', 'other'];
  let firstKind: ToolKind | null = null;
  for (const kind of order) {
    const entry = groups.get(kind);
    if (!entry) continue;
    if (!firstKind) firstKind = kind;
    if (kind === 'bash') { parts.push(entry.count === 1 ? 'ran a command' : `ran ${entry.count} commands`); continue; }
    if (kind === 'search') { parts.push(entry.count === 1 ? 'searched' : `searched ${entry.count} times`); continue; }
    if (kind === 'list') { parts.push('listed files'); continue; }
    if (kind === 'task') { parts.push(entry.count === 1 ? 'ran a task' : `ran ${entry.count} tasks`); continue; }
    if (kind === 'fetch') { parts.push('fetched'); continue; }
    if (kind === 'other') { parts.push(`${entry.name} × ${entry.count}`); continue; }
    const verb = kind === 'read' ? 'read' : kind === 'edit' ? 'edited' : 'wrote';
    if (entry.paths.size === 1) {
      const [path] = entry.paths;
      parts.push(`${verb} ${baseName(path)}`);
    } else if (entry.paths.size > 1) {
      parts.push(`${verb} ${entry.paths.size} files`);
    } else {
      parts.push(`${verb} ${pluralize(entry.count, '1 file', 'files')}`);
    }
  }
  // Internal tool names keep their own casing; verb phrases read as a sentence.
  return firstKind === 'other' ? parts.join(', ') : capitalize(parts.join(', '));
}
