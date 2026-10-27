import { describe, expect, it } from 'vitest';
import type { FileNode } from '@thinkrail/contracts';
import { filterMentions, mentionAt, mentionInsertion, splitMentionQuery } from '../../src/renderer/composer-mentions';

const node = (path: string, kind: 'dir' | 'file'): FileNode => ({ path, name: path.split('/').pop() ?? path, kind });

describe('composer file references', () => {
  it('opens on @ at a word boundary and reads the query up to the caret', () => {
    expect(mentionAt('look at @src', 12)).toEqual({ query: 'src', start: 8 });
    expect(mentionAt('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionAt('see (@src/re', 13)).toEqual({ query: 'src/re', start: 5 });
  });

  it('ignores @ inside a word such as an address', () => {
    expect(mentionAt('mail me at me@host', 18)).toBeNull();
    expect(mentionAt('plain text', 10)).toBeNull();
  });

  it('splits the query into the directory to list and the name to match', () => {
    expect(splitMentionQuery('')).toEqual({ dir: '', filter: '' });
    expect(splitMentionQuery('rend')).toEqual({ dir: '', filter: 'rend' });
    expect(splitMentionQuery('src/renderer/Comp')).toEqual({ dir: 'src/renderer', filter: 'Comp' });
  });

  it('matches prefixes case-insensitively with directories first', () => {
    const nodes = [node('src/zeta.ts', 'file'), node('src/app.tsx', 'file'), node('src/App', 'dir'), node('docs/readme.md', 'file')];
    expect(filterMentions(nodes, 'AP').map(item => item.path)).toEqual(['src/App', 'src/app.tsx']);
    expect(filterMentions(nodes, 'read').map(item => item.path)).toEqual(['docs/readme.md']);
  });

  it('caps the list so the panel stays compact', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node(`file-${index}.ts`, 'file'));
    expect(filterMentions(nodes, 'file', 5)).toHaveLength(5);
  });

  it('keeps directory references open and closes file references', () => {
    expect(mentionInsertion(node('src', 'dir'))).toBe('@src/');
    expect(mentionInsertion(node('src/app.tsx', 'file'))).toBe('@src/app.tsx ');
  });
});
