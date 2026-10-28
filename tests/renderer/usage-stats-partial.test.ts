import { describe, expect, test } from 'vitest';
import type { SessionEntry } from '../../vendor/thinkrail/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager';
import { usageAccumulator } from '../../vendor/thinkrail/packages/server/src/agent/usageStats';

const completeUsage = {
  input: 10, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 19,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(id: string, usage: unknown, date = '2026-10-26T00:30:00Z'): SessionEntry {
  return {
    type: 'message', id, parentId: null, timestamp: date,
    message: {
      role: 'assistant', content: [], timestamp: Date.parse(date), api: 'openai-completions',
      model: 'fixture-model', provider: 'fixture', stopReason: 'stop', usage,
    },
  } as SessionEntry;
}

describe('recorded usage coverage', () => {
  test('missing or invalid categories remain unknown while real zero counts are retained', () => {
    const missing = (['input', 'output', 'cacheRead', 'cacheWrite'] as const).map(field => {
      const value: Record<string, unknown> = { ...completeUsage };
      delete value[field];
      return value;
    });
    const unknown: unknown[] = [undefined, ...missing,
      { ...completeUsage, input: NaN }, { ...completeUsage, output: Infinity }, { ...completeUsage, cacheRead: -1 }];
    const zero = { ...completeUsage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    const aggregate = usageAccumulator('all', 'UTC', 1, Date.parse('2026-10-26T01:00:00Z'));
    aggregate.addSession('workspace', 'session', [
      ...unknown.map((usage, index) => assistant(`unknown-${index}`, usage)),
      assistant('reported', completeUsage),
      assistant('zero', zero),
    ]);
    const result = aggregate.finish();
    expect(result.messages).toBe(10);
    expect(result.totalTokens).toBe(19);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ messages: 2, tokens: { input: 10, output: 2, cacheRead: 3, cacheWrite: 4, total: 19 } });
    expect(result.coverage.unreportedResponses).toBe(8);
    expect(result.coverage.issues).toEqual([{ workspaceId: 'workspace', sessionId: 'session', code: 'INVALID_RECORD' }]);
  });

  test('optional summary usage stays outside the recorded total when absent', () => {
    const aggregate = usageAccumulator('all', 'UTC', 1, Date.parse('2026-10-26T01:00:00Z'));
    aggregate.addSession('workspace', 'session', [
      assistant('reported', completeUsage),
      { type: 'compaction', id: 'compact', parentId: 'reported', timestamp: '2026-10-26T00:30:00Z', summary: '', firstKeptEntryId: 'reported', tokensBefore: 0 },
      { type: 'branch_summary', id: 'branch', parentId: 'compact', timestamp: '2026-10-26T00:30:00Z', summary: '', fromId: 'reported' },
    ]);
    const result = aggregate.finish();
    expect(result.totalTokens).toBe(19);
    expect(result.coverage).toMatchObject({ unreportedResponses: 0, issues: [] });
  });

  test('midnight and the last hour both use the initialized hour buckets', () => {
    const aggregate = usageAccumulator('all', 'UTC', 1, Date.parse('2026-10-26T01:00:00Z'));
    aggregate.addSession('workspace', 'session', [
      assistant('last-hour', completeUsage, '2026-10-25T23:30:00Z'),
      assistant('midnight', completeUsage, '2026-10-26T00:30:00Z'),
    ]);
    const result = aggregate.finish();
    expect(result.messages).toBe(2);
    expect(result.totalTokens).toBe(38);
    expect(result.peakHour).toBe(0);
  });
});
