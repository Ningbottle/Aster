import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Skeleton, SkeletonGroup } from '../../src/renderer/cds/Skeleton';
import { SkeletonSweep, StatusDot } from '../../src/renderer/cds/Status';

describe('skeleton loading placeholders', () => {
  test('keeps placeholders decorative and preserves the original sweep API', () => {
    const html = renderToStaticMarkup(<SkeletonSweep className="usage-skeleton-heat" />);
    expect(html).toContain('aster-skeleton usage-skeleton-heat');
    expect(html).toContain('data-motion="wave"');
    expect(html).toContain('aria-hidden="true"');
  });

  test('groups placeholders under one lockstep surface', () => {
    const html = renderToStaticMarkup(<SkeletonGroup motion="lockstep"><Skeleton index={1} /><Skeleton motion="wave" index={2} /></SkeletonGroup>);
    expect(html.match(/data-motion="lockstep"/g)).toHaveLength(3);
    expect(html.match(/data-grouped=""/g)).toHaveLength(2);
    expect(html).toContain('--cds-skel-i:1');
    expect(html).toContain('--cds-skel-i:2');
    expect(html).not.toContain('data-motion="wave"');
  });

  test('retains the status light label and decorative dot', () => {
    const html = renderToStaticMarkup(<StatusDot kind="running" label="Running" />);
    expect(html).toContain('data-kind="running" aria-hidden="true"');
    expect(html).toContain('Running');
  });
});
