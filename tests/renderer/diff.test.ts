import { describe, expect, test } from 'vitest';
import {
  computeLineDiff,
  diffForToolArgs,
  extractEditPairs,
  extractWriteContent,
  normalizeToolName,
  summarizeChanges,
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
    expect(summarizeChanges([{ name: 'edit', arguments: { path: 'a.ts' } }])).toEqual([]);
  });

  test('reads write content and builds an all-add diff', () => {
    expect(extractWriteContent({ path: 'a.ts', content: 'one\ntwo\n' })).toBe('one\ntwo\n');
    const diff = diffForToolArgs('write', { path: 'a.ts', content: 'one\ntwo\n' });
    expect(diff?.additions).toBe(2);
    expect(diff?.deletions).toBe(0);
    expect(diff?.hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 });
  });

  test('aggregates real per-file changes and normalizes tool names', () => {
    expect(normalizeToolName('builtin.Edit')).toBe('edit');
    expect(toolFilePath({ file_path: 'src/a.ts' })).toBe('src/a.ts');
    const changes = summarizeChanges([
      { name: 'edit', arguments: { path: 'src/a.ts', oldText: 'a', newText: 'a\nb' } },
      { name: 'write', arguments: { path: 'src/b.ts', content: 'x\ny' } },
      { name: 'read', arguments: { path: 'src/c.ts' } },
    ]);
    expect(changes).toEqual([
      { path: 'src/a.ts', additions: 1, deletions: 0 },
      { path: 'src/b.ts', additions: 2, deletions: 0 },
    ]);
  });
});
