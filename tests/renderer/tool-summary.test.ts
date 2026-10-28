import { describe, expect, it } from 'vitest';
import { summarizeTool, summarizeTools } from '../../src/renderer/tool-summary';

describe('tool summaries', () => {
  it('names the single file an operation touched', () => {
    const summary = summarizeTool({ name: 'write', arguments: { path: 'notes\\cv.md', content: 'x' } });
    expect(summary.label).toBe('Wrote');
    expect(summary.file).toBe('cv.md');
    expect(summary.path).toBe('notes\\cv.md');
  });

  it('keeps a bash row path-free and command-agnostic', () => {
    const summary = summarizeTool({ name: 'bash', arguments: { command: 'npm test', path: 'ignored.txt' } });
    expect(summary.label).toBe('Ran a command');
    expect(summary.file).toBeNull();
  });

  it('counts distinct files and never inflates repeated calls on one file', () => {
    const repeated = [
      { name: 'edit', arguments: { path: 'a.md' } },
      { name: 'edit', arguments: { path: 'a.md' } },
    ];
    expect(summarizeTools(repeated)).toBe('Edited a.md');
    expect(summarizeTools([
      { name: 'read', arguments: { path: 'a.md' } },
      { name: 'read', arguments: { path: 'b.md' } },
    ])).toBe('Read 2 files');
  });

  it('falls back to a count when equal basenames live in different folders', () => {
    expect(summarizeTools([
      { name: 'edit', arguments: { path: 'one/cv.md' } },
      { name: 'edit', arguments: { path: 'two/cv.md' } },
    ])).toBe('Edited 2 files');
  });

  it('combines different operation kinds in a stable order', () => {
    expect(summarizeTools([
      { name: 'bash', arguments: { command: 'npm test' } },
      { name: 'edit', arguments: { path: 'cv.md' } },
    ])).toBe('Edited cv.md, ran a command');
  });

  it('keeps unknown tools under their own name', () => {
    expect(summarizeTools([{ name: 'set_title', arguments: {} }])).toBe('set_title × 1');
  });

  it('pluralizes commands from the real call count', () => {
    expect(summarizeTools([
      { name: 'bash', arguments: { command: 'a' } },
      { name: 'bash', arguments: { command: 'b' } },
      { name: 'bash', arguments: { command: 'c' } },
    ])).toBe('Ran 3 commands');
  });
});
