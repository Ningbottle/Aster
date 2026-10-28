import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCard, ToolGroup } from '../../src/renderer/ToolViews';

const write = { id: 'write-1', name: 'write', arguments: { path: 'example.ts', content: 'const answer = 42;\n' } };

test('a pending or failed write does not report applied additions', () => {
  for (const status of ['running', 'failed', 'unknown'] as const) {
    const html = renderToStaticMarkup(<ToolCard tool={{ ...write, status }} initialOpen />);
    expect(html).not.toContain('additions,');
    if (status === 'running') expect(html).toContain('aria-busy="true"');
  }
});

test('a successful tool stays collapsed until the reader opens it', () => {
  const html = renderToStaticMarkup(<ToolCard tool={{ ...write, status: 'succeeded' }} />);
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('role="region"');
  expect(html).toContain('Wrote');
  expect(html).toContain('example.ts');
  expect(html).toContain('stat-add');
});

test('an acknowledged write exposes its diff through a labelled disclosure', () => {
  const html = renderToStaticMarkup(<ToolCard tool={{ ...write, status: 'succeeded' }} initialOpen />);
  expect(html).toContain('additions,');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-controls=');
  expect(html).toContain('role="region" aria-label="Wrote details"');
  expect(html).toContain('diff-card');
  expect(html).toContain('tok-keyword');
  expect(html).toContain('tok-number');
});

test('a mixed group names the edited file and the command without internal icons', () => {
  const html = renderToStaticMarkup(<ToolGroup tools={[
    { id: 'edit-1', name: 'edit', arguments: { path: 'cv.md', oldText: 'a', newText: 'b' }, status: 'succeeded' },
    { id: 'bash-1', name: 'bash', arguments: { command: 'npm test' }, status: 'succeeded' },
  ]} />);
  expect(html).toContain('Edited cv.md, ran a command');
  expect(html).toContain('activity-summary');
  expect(html).not.toContain('Wrench');
});
