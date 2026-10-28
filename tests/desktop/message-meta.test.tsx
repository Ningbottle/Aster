import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageMeta } from '../../src/renderer/cds/Message';

describe('message meta', () => {
  it('renders a real relative time, an ISO value and the copy action', () => {
    const timestamp = Date.now() - 5 * 60_000;
    const markup = renderToStaticMarkup(<MessageMeta timestamp={timestamp} text="hello" align="start" />);

    expect(markup).toContain('<time');
    expect(markup).toContain(`dateTime="${new Date(timestamp).toISOString()}"`);
    expect(markup).toContain('5 minutes ago');
    expect(markup).toContain('aria-label="Copy message"');
  });

  it('never invents a time for a missing or invalid timestamp', () => {
    const markup = renderToStaticMarkup(<MessageMeta timestamp={0} text="hello" align="end" />);

    expect(markup).not.toContain('<time');
    expect(markup).not.toContain('Just now');
    expect(markup).toContain('aria-label="Copy message"');
  });
});
