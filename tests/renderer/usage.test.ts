import { describe, expect, test } from 'vitest';
import type { SessionStats } from '@thinkrail/contracts';
import { apiUsageSegments, contextBreakdown, contextWindowUsage, formatPercent, formatTokens } from '../../src/renderer/usage';

function stats(tokens: number | null, contextWindow: number, usage: Partial<SessionStats['tokens']> = {}): SessionStats {
  return {
    sessionId: 'session-fixture',
    totalMessages: 2,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, ...usage },
    cost: 0,
    contextUsage: { tokens, contextWindow, percent: tokens === null || contextWindow <= 0 ? null : tokens / contextWindow * 100 },
  };
}

describe('session context stats', () => {
  test('formats compact token counts', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_000)).toBe('12k');
    expect(formatTokens(229_000)).toBe('229k');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(80_200_000_000)).toBe('80.2B');
  });

  test('formats sub-percent values without rounding 192 of 128k up to 0.2%', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.012)).toBe('<0.1%');
    expect(formatPercent(0.049)).toBe('<0.1%');
    expect(formatPercent(0.05)).toBe('0.1%');
    expect(formatPercent(0.15)).toBe('0.1%');
    expect(formatPercent(0.996)).toBe('0.9%');
    expect(formatPercent(1)).toBe('1%');
    expect(formatPercent(22.9)).toBe('23%');
  });

  test('reads context occupancy from SessionStats.contextUsage', () => {
    const usage = contextWindowUsage(stats(229_000, 1_000_000));
    expect(usage.percent).toBeCloseTo(22.9);
    expect(usage.percentLabel).toBe('23%');
    expect(usage.usedLabel).toBe('229k');
    expect(usage.capacityLabel).toBe('1M');
    expect(usage.free).toBe(771_000);
    expect(usage.freeLabel).toBe('771k');
    expect(usage.title).toBe('Context window 23% used (229k of 1M tokens, 771k free)');
  });

  test('reports the 192 of 128k fixture request honestly', () => {
    const usage = contextWindowUsage(stats(192, 128_000));
    expect(usage.percent).toBeCloseTo(0.15);
    expect(usage.percentLabel).toBe('0.1%');
    expect(usage.percentNow).toBe(0.1);
    expect(usage.freeLabel).toBe('128k');
    expect(usage.title).toBe('Context window 0.1% used (192 of 128k tokens, 128k free)');
  });

  test('keeps zero usage distinct from unknown usage', () => {
    const zero = contextWindowUsage(stats(0, 128_000));
    expect(zero.percent).toBe(0);
    expect(zero.percentLabel).toBe('0%');
    expect(zero.freeLabel).toBe('128k');
    expect(zero.state).toBe('ready');
    const unknown = contextWindowUsage(stats(null, 128_000));
    expect(unknown.percent).toBeNull();
    expect(unknown.usedLabel).toBe('—');
    expect(unknown.capacityLabel).toBe('128k');
    expect(unknown.state).toBe('unknown');
    expect(unknown.title).toBe('Context window: usage unknown after compaction (128k capacity)');
    const unreported = contextWindowUsage(null);
    expect(unreported.state).toBe('unreported');
    expect(unreported.title).toBe('Context window: no usage reported yet');
  });

  test('never reports negative free space when usage exceeds the window', () => {
    const usage = contextWindowUsage(stats(200_000, 128_000));
    expect(usage.percent).toBe(100);
    expect(usage.percentLabel).toBe('100%');
    expect(usage.free).toBe(0);
    expect(usage.freeLabel).toBe('0');
  });

  test('builds one aggregate used row plus free space, never relabelled API types', () => {
    const usage = contextWindowUsage(stats(229_000, 1_000_000));
    const rows = contextBreakdown(usage);
    expect(rows.map(row => [row.label, row.percentLabel])).toEqual([
      ['Used', '22.9%'],
      ['Free space', '77.1%'],
    ]);
    expect(rows.map(row => row.value)).toEqual([229_000, 771_000]);
    expect(contextBreakdown(contextWindowUsage(null))).toEqual([]);
  });

  test('keeps whole-session token types as a separate API usage list', () => {
    const segments = apiUsageSegments(stats(229_000, 1_000_000, { input: 160_000, output: 12_000, cacheRead: 50_000, cacheWrite: 7000, total: 229_000 }));
    expect(segments.map(segment => segment.label)).toEqual(['Input', 'Output', 'Cache read', 'Cache write']);
    expect(segments.map(segment => segment.value)).toEqual([160_000, 12_000, 50_000, 7000]);
    expect(apiUsageSegments(stats(0, 1000))).toEqual([]);
  });
});
