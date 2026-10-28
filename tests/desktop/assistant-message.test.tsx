import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantMessage } from '../../src/renderer/cds/Message';

/**
 * The assistant turn keeps its body in its own slot so spacing rules key on the
 * last real block, and a turn that only ran tools has no timeline to hover.
 */
describe('assistant message shell', () => {
  it('renders the body slot before the meta row', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage plainText="prose" timestamp={Date.now()}><p>prose</p></AssistantMessage>,
    );

    expect(markup).toContain('class="assistant-body"');
    expect(markup).toContain('message-meta');
    expect(markup.indexOf('assistant-body')).toBeLessThan(markup.indexOf('message-meta'));
  });

  it('omits the timeline for a turn that only ran tools', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage plainText="" timestamp={Date.now()}><div className="tool-card">read</div></AssistantMessage>,
    );

    expect(markup).toContain('class="assistant-body"');
    expect(markup).not.toContain('message-meta');
    expect(markup).not.toContain('<time');
  });

  it('keeps the copy action for a turn with text even without a timestamp', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage plainText="prose"><p>prose</p></AssistantMessage>,
    );

    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).not.toContain('<time');
  });
});
