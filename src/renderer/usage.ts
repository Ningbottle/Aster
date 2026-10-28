import type { SessionStats } from '@thinkrail/contracts';

/** Compact token counts for the ring tooltip, the Context card and API usage rows. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000_000) return `${Number((count / 1_000_000_000).toFixed(1))}B`;
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${Number(millions.toFixed(millions >= 10 ? 0 : 1))}M`;
  }
  if (count >= 1000) {
    const thousands = count / 1000;
    return `${Number(thousands.toFixed(thousands >= 100 ? 0 : 1))}k`;
  }
  return count.toLocaleString();
}

/**
 * Keeps small windows readable without inventing precision: 192 of 128k is 0.15%, which
 * reads as 0.1% rather than rounding up, and anything under 0.05% is reported as <0.1%.
 */
function percentDisplay(percent: number): { label: string; value: number } {
  if (percent <= 0) return { label: '0%', value: 0 };
  if (percent < 0.05) return { label: '<0.1%', value: 0.05 };
  if (percent < 1) {
    const value = Math.max(1, Math.floor(percent * 10)) / 10;
    return { label: `${value}%`, value };
  }
  const value = Math.round(percent);
  return { label: `${value}%`, value };
}

export interface ContextWindowView {
  /** Pi's session.getContextUsage() reading; null until the host reports one. */
  tokens: number | null;
  capacity: number | null;
  /** Exact ratio for meters/rings; null when tokens or capacity are unknown. */
  percent: number | null;
  /** Display form of percent: integer at >=1%, one decimal below 1%, floor 0.1%. */
  percentLabel: string | null;
  /** Numeric value that matches percentLabel, for meter aria-valuenow. */
  percentNow: number | null;
  usedLabel: string;
  capacityLabel: string | null;
  /** capacity - tokens, clamped at zero; null when either side is unknown. */
  free: number | null;
  freeLabel: string | null;
  /**
   * ready: Pi returned a token count. unknown: the model window is known but Pi
   * reports no count (its only such case is the gap after compaction). unreported:
   * stats carry no context window at all, e.g. before the session has a model.
   */
  state: 'ready' | 'unknown' | 'unreported';
  title: string;
}

/**
 * Context occupancy comes from SessionStats.contextUsage (ThinkRail's native session stats),
 * not from the last assistant request's Usage. The semantic buckets Claude shows
 * (Messages/System tools/Skills/...) are not part of this contract.
 */
export function contextWindowUsage(stats: SessionStats | null | undefined): ContextWindowView {
  const context = stats?.contextUsage;
  const tokens = typeof context?.tokens === 'number' && Number.isFinite(context.tokens) && context.tokens >= 0 ? context.tokens : null;
  const capacity = typeof context?.contextWindow === 'number' && Number.isFinite(context.contextWindow) && context.contextWindow > 0
    ? context.contextWindow
    : null;
  const percent = tokens !== null && capacity !== null
    ? Math.min(100, Math.max(0, typeof context?.percent === 'number' ? context.percent : tokens / capacity * 100))
    : null;
  const display = percent === null ? null : percentDisplay(percent);
  const percentLabel = display?.label ?? null;
  const percentNow = display?.value ?? null;
  const usedLabel = tokens === null ? '—' : formatTokens(tokens);
  const capacityLabel = capacity === null ? null : formatTokens(capacity);
  const free = tokens !== null && capacity !== null ? Math.max(0, capacity - tokens) : null;
  const freeLabel = free === null ? null : formatTokens(free);
  const state: ContextWindowView['state'] = tokens !== null ? 'ready' : capacity === null ? 'unreported' : 'unknown';
  const title = tokens === null
    ? capacityLabel
      ? `Context window: usage unknown after compaction (${capacityLabel} capacity)`
      : 'Context window: no usage reported yet'
    : percentLabel && capacityLabel && freeLabel
      ? `Context window ${percentLabel} used (${usedLabel} of ${capacityLabel} tokens, ${freeLabel} free)`
      : `Context window: ${usedLabel} tokens used; model context window unknown`;
  return { tokens, capacity, percent, percentLabel, percentNow, usedLabel, capacityLabel, free, freeLabel, state, title };
}

export interface UsageSegment {
  label: string;
  value: number;
  color: string;
}

const TOKEN_COLORS = {
  Input: '#5d7f9f',
  Output: '#5e8f74',
  'Cache read': '#b08a4c',
  'Cache write': '#9a6f58',
} as const;

/** API token totals for the whole session, including turns before compaction; kept separate from context occupancy. */
export function apiUsageSegments(stats: SessionStats | null | undefined): UsageSegment[] {
  const tokens = stats?.tokens;
  if (!tokens) return [];
  return ([
    ['Input', tokens.input, TOKEN_COLORS.Input],
    ['Output', tokens.output, TOKEN_COLORS.Output],
    ['Cache read', tokens.cacheRead, TOKEN_COLORS['Cache read']],
    ['Cache write', tokens.cacheWrite, TOKEN_COLORS['Cache write']],
  ] as const).filter(([, value]) => value > 0).map(([label, value, color]) => ({ label, value, color }));
}

export interface UsageBreakdownRow {
  label: string;
  value: number;
  /** Null for Free space, which uses the neutral track colour. */
  color: string | null;
  /** Exact share of the context window, or null when the capacity is unknown. */
  percent: number | null;
  /** One-decimal share of the context window, as shown in the details card. */
  percentLabel: string | null;
}

/** Context rows: one aggregate used segment plus the remaining window. Never relabelled API types. */
export function contextBreakdown(view: ContextWindowView): UsageBreakdownRow[] {
  if (view.tokens === null) return [];
  const row = (label: string, value: number, color: string | null): UsageBreakdownRow => {
    const percent = view.capacity === null || view.capacity <= 0 ? null : value / view.capacity * 100;
    return { label, value, color, percent, percentLabel: percent === null ? null : `${percent.toFixed(1)}%` };
  };
  const rows = [row('Used', view.tokens, 'var(--data-blue)')];
  if (view.free !== null) rows.push(row('Free space', view.free, null));
  return rows;
}
