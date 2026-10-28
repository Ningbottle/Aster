import { describe, expect, test } from 'vitest';
import {
  computeLineDiff,
  diffForToolArgs,
  extractEditPairs,
  extractWriteContent,
  languageOf,
  normalizeToolName,
  splitRows,
  toolFilePath,
} from '../../src/renderer/diff';

describe('computeLineDiff', () => {
  test('reports a one-line replacement with both sides and context', () => {
    const diff = computeLineDiff('alpha\nbeta\ngamma\ndelta', 'alpha\nBETA\ngamma\ndelta');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.hunks).toHaveLength(1);
    const hunk = diff.hunks[0];
    expect(hunk.lines.map(line => [line.kind, line.text])).toEqual([
      ['context', 'alpha'],
      ['del', 'beta'],
      ['add', 'BETA'],
      ['context', 'gamma'],
      ['context', 'delta'],
    ]);
    expect(hunk.lines.find(line => line.kind === 'del')).toMatchObject({ oldNumber: 2, newNumber: null });
    expect(hunk.lines.find(line => line.kind === 'add')).toMatchObject({ oldNumber: null, newNumber: 2 });
    expect(hunk).toMatchObject({ oldStart: 1, oldCount: 4, newStart: 1, newCount: 4 });
  });

  test('reports a pure insertion and a pure deletion', () => {
    const insertion = computeLineDiff('one\ntwo\nthree', 'one\ninserted\ntwo\nthree');
    expect(insertion.additions).toBe(1);
    expect(insertion.deletions).toBe(0);
    expect(insertion.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 });

    const deletion = computeLineDiff('one\ntwo\nthree', 'one\nthree');
    expect(deletion.additions).toBe(0);
    expect(deletion.deletions).toBe(1);
    expect(deletion.hunks[0].lines.filter(line => line.kind === 'del')).toHaveLength(1);
    expect(deletion.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 2 });
  });

  test('returns no hunks when the texts are equal', () => {
    expect(computeLineDiff('same\ntext', 'same\ntext')).toEqual({ hunks: [], additions: 0, deletions: 0 });
  });

  test('keeps three context lines and numbers the hunk against its own slice', () => {
    const oldText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const newText = oldText.replace('line 10', 'changed 10');
    const diff = computeLineDiff(oldText, newText);
    expect(diff.hunks).toHaveLength(1);
    const hunk = diff.hunks[0];
    expect(hunk.oldStart).toBe(7);
    expect(hunk.oldCount).toBe(7);
    expect(hunk.newStart).toBe(7);
    expect(hunk.newCount).toBe(7);
    expect(hunk.lines[0].text).toBe('line 7');
    expect(hunk.lines.at(-1)?.text).toBe('line 13');
  });

  test('creates two hunks when changes are far apart', () => {
    const oldText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const newText = oldText.replace('line 3', 'changed 3').replace('line 18', 'changed 18');
    const diff = computeLineDiff(oldText, newText);
    expect(diff.hunks).toHaveLength(2);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
  });
});

describe('tool argument extraction', () => {
  test('accepts Pi oldText/newText and old_string/new_string', () => {
    expect(extractEditPairs({ path: 'a.ts', oldText: 'a', newText: 'b' })).toEqual([{ oldText: 'a', newText: 'b' }]);
    expect(extractEditPairs({ path: 'a.ts', old_string: 'a', new_string: 'b' })).toEqual([{ oldText: 'a', newText: 'b' }]);
    expect(extractEditPairs({ path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }] })).toHaveLength(2);
  });

  test('returns null when no old/new pair exists', () => {
    expect(extractEditPairs({ path: 'a.ts' })).toBeNull();
    expect(extractEditPairs(null)).toBeNull();
    expect(diffForToolArgs('edit', { path: 'a.ts' })).toBeNull();
  });

  test('reads write content and builds an all-add diff', () => {
    expect(extractWriteContent({ path: 'a.ts', content: 'one\ntwo\n' })).toBe('one\ntwo\n');
    const diff = diffForToolArgs('write', { path: 'a.ts', content: 'one\ntwo\n' });
    expect(diff?.additions).toBe(2);
    expect(diff?.deletions).toBe(0);
    expect(diff?.hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 });
  });

  test('normalizes tool names and reads file paths', () => {
    expect(normalizeToolName('builtin.Edit')).toBe('edit');
    expect(toolFilePath({ file_path: 'src/a.ts' })).toBe('src/a.ts');
  });
});

describe('splitRows', () => {
  const line = (kind: 'context' | 'add' | 'del', text: string, oldNumber: number | null, newNumber: number | null) => ({ kind, text, oldNumber, newNumber });

  test('pairs a replacement run on one row and pads the shorter side', () => {
    const rows = splitRows([
      line('del', 'a', 1, null),
      line('del', 'b', 2, null),
      line('add', 'a2', null, 1),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ left: expect.objectContaining({ text: 'a' }), right: expect.objectContaining({ text: 'a2' }) });
    expect(rows[1]).toEqual({ left: expect.objectContaining({ text: 'b' }), right: null });
  });

  test('keeps context lines on both sides and separates blocks', () => {
    const rows = splitRows([
      line('del', 'old', 1, null),
      line('add', 'new', null, 1),
      line('context', 'stay', 2, 2),
      line('add', 'extra', null, 3),
    ]);
    expect(rows.map(row => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ['old', 'new'],
      ['stay', 'stay'],
      [null, 'extra'],
    ]);
  });
});

describe('languageOf', () => {
  test('labels known extensions and stays empty otherwise', () => {
    expect(languageOf('src/App.tsx')).toBe('tsx');
    expect(languageOf('docs\\readme.MD')).toBe('md');
    expect(languageOf('src/config.yml')).toBe('yaml');
    expect(languageOf('LICENSE')).toBe('');
  });
});
