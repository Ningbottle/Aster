import { describe, expect, test } from 'vitest';
import { extensionOf, needsBinary, previewKind } from '../../src/renderer/preview-kind';

describe('preview routing', () => {
  test('sends images and PDFs through the binary read', () => {
    expect(needsBinary('assets/photo.PNG')).toBe(true);
    expect(needsBinary('docs/plan.pdf')).toBe(true);
    expect(needsBinary('icons/mark.svg')).toBe(true);
    expect(needsBinary('notes.md')).toBe(false);
    expect(previewKind('assets/photo.PNG', false)).toBe('image');
    expect(previewKind('docs/plan.pdf', false)).toBe('pdf');
  });

  test('renders markdown and keeps other text as columns', () => {
    expect(previewKind('README.md', true)).toBe('markdown');
    expect(previewKind('docs/guide.mdx', true)).toBe('markdown');
    expect(previewKind('src/main.ts', true)).toBe('text');
    expect(previewKind('LICENSE', true)).toBe('text');
  });

  test('reports unknown binary files instead of decoding them', () => {
    expect(needsBinary('archive.zip')).toBe(false);
    expect(previewKind('archive.zip', false)).toBe('binary');
  });

  test('reads the extension from the file name, not the directory', () => {
    expect(extensionOf('a.b/README')).toBe('');
    expect(extensionOf('C:\\work\\plan.PDF')).toBe('pdf');
  });
});
