import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCard } from '../../src/renderer/ToolViews';

const write = { id: 'write-1', name: 'write', arguments: { path: 'example.md', content: 'first\nsecond\n' } };

test('a pending or failed write does not report applied additions', () => {
  for (const status of ['running', 'failed', 'unknown'] as const) {
    const html = renderToStaticMarkup(<ToolCard tool={{ ...write, status }} initialOpen />);
    expect(html).not.toContain('additions,');
    if (status === 'running') expect(html).toContain('aria-busy="true"');
  }
});

test('an acknowledged write exposes its diff through a labelled disclosure', () => {
  const html = renderToStaticMarkup(<ToolCard tool={{ ...write, status: 'succeeded' }} />);
  expect(html).toContain('additions,');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-controls=');
  expect(html).toContain('role="region" aria-label="Wrote details"');
});
