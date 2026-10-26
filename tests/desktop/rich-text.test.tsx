import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichText } from '../../src/renderer/RichText';

describe('RichText', () => {
  it('renders GFM blocks and inline formatting as semantic elements', () => {
    const markup = renderToStaticMarkup(
      <RichText text={'# Heading\n\nA **bold** sentence with `code`.\n\n- first\n- second\n\n| Key | Value |\n| --- | --- |\n| a | b |\n\n```ts\nconst answer = 42;\n```'} />,
    );

    expect(markup).toContain('<h1>Heading</h1>');
    expect(markup).toContain('<p>A <strong>bold</strong> sentence with <code>code</code>.</p>');
    expect(markup).toContain('<ul>');
    expect(markup).toContain('<table>');
    expect(markup).toContain('<pre><code class="language-ts">const answer = 42;');
  });

  it('keeps normal links visible while omitting unsafe links and raw HTML', () => {
    const markup = renderToStaticMarkup(
      <RichText text={'[Docs](https://example.com/docs) [bad](javascript:alert%281%29) <script>alert(1)</script>'} />,
    );

    expect(markup).toContain('<a href="https://example.com/docs" title="https://example.com/docs">Docs</a>');
    expect(markup).toContain('<span>bad</span>');
    expect(markup).not.toContain('javascript:');
    expect(markup).not.toContain('<script');
  });

  it('shows image alt text without creating a remote image element', () => {
    const markup = renderToStaticMarkup(<RichText text="![diagram](https://example.com/diagram.png)" />);

    expect(markup).toContain('aria-label="diagram"');
    expect(markup).toContain('>diagram</span>');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('src=');
  });
});
