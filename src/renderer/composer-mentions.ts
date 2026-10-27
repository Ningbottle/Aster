/*
 * Adapted from Caho1/open-claude-ui, code-examples/RichComposerWithMentions.tsx,
 * MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * Reference detection and listing stays in pure helpers so the composer only
 * owns the keyboard and the panel.
 */
import type { FileNode } from '@thinkrail/contracts';

export interface MentionToken {
  /** Text after `@`, may contain `/` to walk into a directory. */
  query: string;
  /** Index of the `@` in the draft. */
  start: number;
}

/**
 * `@` starts a reference only at a word boundary, so `mail@host` stays text.
 * The caret is where the user is typing; text after it is untouched.
 */
export function mentionAt(text: string, caret: number): MentionToken | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const match = /(?:^|[\s(])@([^\s@]*)$/.exec(text.slice(0, end));
  if (!match) return null;
  return { query: match[1], start: end - match[1].length - 1 };
}

/** `src/rend` lists `src/` and filters on `rend`. */
export function splitMentionQuery(query: string): { dir: string; filter: string } {
  const cut = query.lastIndexOf('/');
  return cut < 0 ? { dir: '', filter: query } : { dir: query.slice(0, cut), filter: query.slice(cut + 1) };
}

/** Case-insensitive prefix match, directories first, capped for a compact panel. */
export function filterMentions(nodes: readonly FileNode[], filter: string, limit = 8): FileNode[] {
  const needle = filter.toLocaleLowerCase();
  return nodes
    .filter(node => node.name.toLocaleLowerCase().startsWith(needle))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    .slice(0, limit);
}

/** Directory picks keep the reference open so the next segment can be typed. */
export function mentionInsertion(node: Pick<FileNode, 'path' | 'kind'>): string {
  return `@${node.path}${node.kind === 'dir' ? '/' : ' '}`;
}
