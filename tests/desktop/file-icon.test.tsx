import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileIcon } from '../../src/renderer/FileIcon';

describe('FileIcon', () => {
  it('uses a monochrome SVG slot instead of a character placeholder', () => {
    const markup = renderToStaticMarkup(<FileIcon path="src/renderer/App.tsx" />);

    expect(markup).toContain('class="file-icon"');
    expect(markup).toContain('<svg');
    expect(markup).not.toMatch(/>[?@]</);
  });

  it('distinguishes code, web, document and unknown extensions', () => {
    const code = renderToStaticMarkup(<FileIcon path="a.ts" />);
    const web = renderToStaticMarkup(<FileIcon path="a.html" />);
    const document = renderToStaticMarkup(<FileIcon path="a.pdf" />);
    const unknown = renderToStaticMarkup(<FileIcon path="a.unknown" />);

    expect(new Set([code, web, document, unknown]).size).toBe(4);
    expect(unknown).not.toContain('>?<');
  });
});
