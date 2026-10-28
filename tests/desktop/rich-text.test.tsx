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
    expect(markup).toContain('<pre><code class="language-ts">');
    expect(markup).toContain('tok-keyword');
    expect(markup).toContain('answer');
  });

  it('keeps emphasis next to Chinese punctuation as emphasis, not literal stars', () => {
    /** CommonMark refuses emphasis when a CJK punctuation sits inside the closing run.
     * remark-cjk-friendly parses it as emphasis; the stars must never reach the DOM. */
    const markup = renderToStaticMarkup(<RichText text={'**优先级建议：**编程基础\n\n**练习项目：**命令行记账本'} />);

    expect(markup).toContain('<strong>优先级建议：</strong>编程基础');
    expect(markup).toContain('<strong>练习项目：</strong>命令行记账本');
    expect(markup).not.toContain('**');
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

  it('explains a fenced block that is too long to highlight', () => {
    const long = 'a'.repeat(120_001);
    const markup = renderToStaticMarkup(<RichText text={'```ts\n' + long + '\n```'} />);

    expect(markup).toContain('role="note"');
    expect(markup).toContain('Large block shown as plain text');
    expect(markup).not.toContain('tok-keyword');
  });

  it('shows image alt text without creating a remote image element', () => {
    const markup = renderToStaticMarkup(<RichText text="![diagram](https://example.com/diagram.png)" />);

    expect(markup).toContain('aria-label="diagram"');
    expect(markup).toContain('>diagram</span>');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('src=');
  });
});
