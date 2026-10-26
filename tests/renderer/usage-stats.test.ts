import { describe, expect, test } from 'vitest';
import type { SessionEntry } from '../../vendor/thinkrail/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager';
import { usageAccumulator, usageRequest } from '../../vendor/thinkrail/packages/server/src/agent/usageStats';
import { buildHeatmap } from '../../src/renderer/UsageDashboard';

function entry(id: string, date: string, role: 'user' | 'assistant', tokens = 100, model = 'model-a'): SessionEntry {
  const timestamp = Date.parse(date);
  return { type: 'message', id, parentId: null, timestamp: date, message: role === 'user'
    ? { role, content: 'fixture text is never returned in statistics', timestamp }
    : { role, content: [], timestamp, api: 'openai-completions', model, provider: 'fixture', stopReason: 'stop',
      usage: { input: tokens, output: 10, cacheRead: 20, cacheWrite: 30, totalTokens: tokens + 60, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } };
}

describe('native usage statistics', () => {
  test('deduplicates forked entries but counts matching sessions; caches and auxiliary usage are counted once', () => {
    const aggregate = usageAccumulator('all', 'Asia/Shanghai', 1, Date.parse('2026-10-26T06:00:00Z'));
    const rows = [entry('user-a', '2026-10-25T16:30:00Z', 'user'), entry('response-a', '2026-10-25T16:31:00Z', 'assistant')];
    aggregate.addSession('workspace', 'original', rows);
    aggregate.addSession('workspace', 'fork', [...rows, entry('response-b', '2026-10-26T02:00:00Z', 'assistant', 500, 'model-b'),
      { type: 'compaction', id: 'compact-a', parentId: null, timestamp: '2026-10-26T02:01:00Z', summary: 'not exported', firstKeptEntryId: 'response-b', tokensBefore: 0,
        usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }]);
    const result = aggregate.finish();
    expect(result.sessions).toBe(2);
    expect(result.messages).toBe(3);
    expect(result.totalTokens).toBe(730);
    expect(result.activeDays).toBe(1);
    expect(result.peakHour).toBe(0);
    expect(result.favoriteModel).toEqual({ provider: 'fixture', id: 'model-b' });
    expect(result.models.map(model => [model.id, model.tokens.total])).toEqual([['model-b', 560], ['model-a', 160], ['', 10]]);
    expect(JSON.stringify(result)).not.toContain('fixture text');
    expect(JSON.stringify(result)).not.toContain('not exported');
  });

  test('7 days includes the current local day and six preceding dates, across DST', () => {
    const aggregate = usageAccumulator('7d', 'America/New_York', 1, Date.parse('2026-11-03T15:00:00Z'));
    aggregate.addSession('workspace', 'dates', [
      entry('outside', '2026-10-28T03:59:59Z', 'assistant'), // local Oct 27
      entry('boundary', '2026-10-28T04:00:00Z', 'assistant'), // local Oct 28
      entry('repeat-hour-a', '2026-11-01T05:30:00Z', 'assistant'),
      entry('repeat-hour-b', '2026-11-01T06:30:00Z', 'assistant'),
      entry('future', '2026-11-04T00:00:00Z', 'assistant'),
    ]);
    const result = aggregate.finish();
    expect(result.messages).toBe(3);
    expect(result.totalTokens).toBe(480);
    expect(result.daily.map(day => day.date)).toEqual(['2026-10-28', '2026-11-01']);
    expect(result.peakHour).toBe(1);
  });

  test('unknown usage remains a coverage gap rather than a fabricated reading', () => {
    const aggregate = usageAccumulator('30d', 'UTC', 1, Date.parse('2026-10-26T06:00:00Z'));
    const row = entry('unknown', '2026-10-26T02:00:00Z', 'assistant');
    if (row.type !== 'message' || row.message.role !== 'assistant') throw new Error('Invalid fixture');
    delete (row.message as Partial<typeof row.message>).usage;
    aggregate.addSession('workspace', 'session', [row]);
    aggregate.issue('unreadable-workspace', 'UNREADABLE_WORKSPACE');
    const result = aggregate.finish();
    expect(result.messages).toBe(1);
    expect(result.totalTokens).toBe(0);
    expect(result.models).toEqual([]);
    expect(result.favoriteModel).toBeNull();
    expect(result.coverage.unreportedResponses).toBe(1);
    expect(result.coverage.issues).toHaveLength(2);
  });

  test('validates ranges/time zones and refuses client-supplied paths', () => {
    expect(usageRequest({ range: '7d', timeZone: 'Asia/Shanghai' })).toEqual({ range: '7d', timeZone: 'Asia/Shanghai' });
    for (const params of [null, [], { range: '1d', timeZone: 'UTC' }, { range: 'all', timeZone: 'fake-zone' }, { range: 'all', timeZone: 'UTC', path: 'outside' }]) {
      expect(() => usageRequest(params)).toThrow(/Invalid usage/);
    }
  });

  test('All heatmap retains past activity when today is empty and range excludes only outside dates', () => {
    const aggregate = usageAccumulator('all', 'UTC', 1, Date.parse('2026-10-26T06:00:00Z'));
    aggregate.addSession('workspace', 'session', [entry('old', '2026-10-20T02:00:00Z', 'assistant')]);
    const summary = aggregate.finish();
    const all = buildHeatmap(summary, '2026-10-26', 'all');
    expect(all).toHaveLength(26 * 7);
    expect(all.find(day => day.date === '2026-10-20')).toMatchObject({ messages: 1, level: 4, state: 'in-range' });
    expect(all.find(day => day.date === '2026-10-27')?.state).toBe('future');
    const week = buildHeatmap(summary, '2026-10-26', '7d');
    expect(week.find(day => day.date === '2026-10-19')?.state).toBe('out-of-range');
    expect(week.find(day => day.date === '2026-10-20')?.state).toBe('in-range');
  });
});
