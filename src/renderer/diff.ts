/**
 * Line diff for real tool arguments. Pure, dependency-free, and deliberately
 * conservative: when the inputs are too large for the LCS table it falls back
 * to common prefix/suffix plus a replaced middle block instead of guessing.
 */

export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface LineDiff {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface EditPair {
  oldText: string;
  newText: string;
}

interface Op {
  kind: 'equal' | 'add' | 'del';
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

const MAX_TABLE_CELLS = 4_000_000;

export function splitDiffLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function tableDiff(oldLines: string[], newLines: string[]): Op[] {
  const rows = oldLines.length;
  const cols = newLines.length;
  const width = cols + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      table[row * width + col] = oldLines[row] === newLines[col]
        ? table[(row + 1) * width + col + 1] + 1
        : Math.max(table[(row + 1) * width + col], table[row * width + col + 1]);
    }
  }
  const ops: Op[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (oldLines[row] === newLines[col]) {
      ops.push({ kind: 'equal', text: oldLines[row], oldNumber, newNumber });
      row += 1; col += 1; oldNumber += 1; newNumber += 1;
    } else if (table[(row + 1) * width + col] >= table[row * width + col + 1]) {
      ops.push({ kind: 'del', text: oldLines[row], oldNumber, newNumber: null });
      row += 1; oldNumber += 1;
    } else {
      ops.push({ kind: 'add', text: newLines[col], oldNumber: null, newNumber });
      col += 1; newNumber += 1;
    }
  }
  while (row < rows) {
    ops.push({ kind: 'del', text: oldLines[row], oldNumber, newNumber: null });
    row += 1; oldNumber += 1;
  }
  while (col < cols) {
    ops.push({ kind: 'add', text: newLines[col], oldNumber: null, newNumber });
    col += 1; newNumber += 1;
  }
  return ops;
}

function blockDiff(oldLines: string[], newLines: string[]): Op[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;

  const ops: Op[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  for (let index = 0; index < prefix; index += 1) {
    ops.push({ kind: 'equal', text: oldLines[index], oldNumber, newNumber });
    oldNumber += 1; newNumber += 1;
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    ops.push({ kind: 'del', text: oldLines[index], oldNumber, newNumber: null });
    oldNumber += 1;
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    ops.push({ kind: 'add', text: newLines[index], oldNumber: null, newNumber });
    newNumber += 1;
  }
  for (let index = oldLines.length - suffix; index < oldLines.length; index += 1) {
    ops.push({ kind: 'equal', text: oldLines[index], oldNumber, newNumber });
    oldNumber += 1; newNumber += 1;
  }
  return ops;
}

function lineOps(oldText: string, newText: string): Op[] {
  const oldLines = splitDiffLines(oldText);
  const newLines = splitDiffLines(newText);
  if (!oldLines.length && !newLines.length) return [];
  const cells = oldLines.length * newLines.length;
  return cells <= MAX_TABLE_CELLS ? tableDiff(oldLines, newLines) : blockDiff(oldLines, newLines);
}

function previousNumber(ops: Op[], index: number, key: 'oldNumber' | 'newNumber'): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const value = ops[cursor][key];
    if (value !== null) return value;
  }
  return 0;
}

function contextRanges(ops: Op[], context: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].kind === 'equal') continue;
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}

export function computeLineDiff(oldText: string, newText: string, context = 3): LineDiff {
  const ops = lineOps(oldText, newText);
  const additions = ops.filter(op => op.kind === 'add').length;
  const deletions = ops.filter(op => op.kind === 'del').length;
  if (!additions && !deletions) return { hunks: [], additions: 0, deletions: 0 };

  const hunks = contextRanges(ops, Math.max(0, context)).map(range => {
    const lines: DiffLine[] = ops.slice(range.start, range.end).map(op => ({
      kind: op.kind === 'equal' ? 'context' : op.kind,
      oldNumber: op.oldNumber,
      newNumber: op.newNumber,
      text: op.text,
    }));
    const firstOld = lines.find(line => line.oldNumber !== null)?.oldNumber;
    const firstNew = lines.find(line => line.newNumber !== null)?.newNumber;
    return {
      oldStart: firstOld ?? previousNumber(ops, range.start, 'oldNumber'),
      newStart: firstNew ?? previousNumber(ops, range.start, 'newNumber'),
      oldCount: lines.filter(line => line.oldNumber !== null).length,
      newCount: lines.filter(line => line.newNumber !== null).length,
      lines,
    };
  });
  return { hunks, additions, deletions };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function toolFilePath(args: unknown): string | undefined {
  const record = asRecord(args);
  return record ? stringField(record, ['path', 'file_path', 'filePath', 'filename']) : undefined;
}

function pairFrom(record: Record<string, unknown>): EditPair | null {
  const direct = [
    ['oldText', 'newText'],
    ['old_string', 'new_string'],
    ['oldString', 'newString'],
  ] as const;
  for (const [oldKey, newKey] of direct) {
    const oldText = record[oldKey];
    const newText = record[newKey];
    if (typeof oldText === 'string' && typeof newText === 'string') return { oldText, newText };
  }
  return null;
}

/** Real replacement pairs from Pi's edit (oldText/newText, edits[], or old_string/new_string). */
export function extractEditPairs(args: unknown): EditPair[] | null {
  const record = asRecord(args);
  if (!record) return null;
  const direct = pairFrom(record);
  if (direct) return [direct];
  if (!Array.isArray(record.edits)) return null;
  const pairs: EditPair[] = [];
  for (const entry of record.edits) {
    const edit = asRecord(entry);
    const pair = edit ? pairFrom(edit) : null;
    if (pair) pairs.push(pair);
  }
  return pairs.length ? pairs : null;
}

/** Pi's write tool carries the complete new file in `content`. */
export function extractWriteContent(args: unknown): string | null {
  const record = asRecord(args);
  if (!record) return null;
  return typeof record.content === 'string' ? record.content : null;
}

export function normalizeToolName(name: string): string {
  const tail = name.split('.').at(-1) ?? name;
  return tail.toLocaleLowerCase();
}

export function diffForToolArgs(name: string, args: unknown): LineDiff | null {
  const tool = normalizeToolName(name);
  if (tool === 'edit') {
    const pairs = extractEditPairs(args);
    if (!pairs) return null;
    return pairs.reduce<LineDiff>((total, pair) => {
      const part = computeLineDiff(pair.oldText, pair.newText);
      return {
        hunks: [...total.hunks, ...part.hunks],
        additions: total.additions + part.additions,
        deletions: total.deletions + part.deletions,
      };
    }, { hunks: [], additions: 0, deletions: 0 });
  }
  if (tool === 'write') {
    const content = extractWriteContent(args);
    return content === null ? null : computeLineDiff('', content);
  }
  return null;
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pairs each run of deletions with the additions that follow it, so the split
 * view keeps one edit on one row and pads the other side.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let deleted: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    const count = Math.max(deleted.length, added.length);
    for (let index = 0; index < count; index += 1) rows.push({ left: deleted[index] ?? null, right: added[index] ?? null });
    deleted = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === 'context') {
      flush();
      rows.push({ left: line, right: line });
    } else if (line.kind === 'del') {
      if (added.length) flush();
      deleted.push(line);
    } else {
      added.push(line);
    }
  }
  flush();
  return rows;
}

/** Language tag for the diff header; empty when the extension is unknown. */
export function languageOf(path: string): string {
  const extension = path.replaceAll('\\', '/').split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', css: 'css', json: 'json', md: 'md', py: 'py', rs: 'rust', go: 'go', sh: 'sh', yml: 'yaml', yaml: 'yaml', html: 'html' };
  return known[extension] ?? '';
}
