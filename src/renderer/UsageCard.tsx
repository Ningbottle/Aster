import type { SessionStats } from '@thinkrail/contracts';
import { apiUsageSegments, contextBreakdown, formatTokens, type ContextWindowView } from './usage';

/**
 * Shared body for the composer popover and the details card, so both read the same
 * Pi values. A missing reading renders the neutral track, never a filled bar.
 */
export function ContextUsageMeter({ usage }: { usage: ContextWindowView }) {
  const rows = contextBreakdown(usage);
  const meter = usage.percent !== null && usage.percentLabel !== null;
  const heading = usage.percentLabel
    ? `${usage.percentLabel} used`
    : usage.state === 'unknown' ? 'Usage unknown' : 'No reading yet';
  const value = usage.capacityLabel ? `${usage.usedLabel} / ${usage.capacityLabel}` : `${usage.usedLabel} tokens`;
  return <>
    <div className="usage-heading"><span>{heading}</span><span>{value}</span></div>
    <div className="usage-bar" {...measureProps(usage, meter)}>
      {meter && <div className="usage-used" style={{ width: `${usage.percent}%`, minWidth: usage.percent ? 2 : undefined }}>
        <span style={{ width: '100%', background: 'var(--data-blue)' }} />
      </div>}
    </div>
    {rows.length > 0 && <dl className="usage-breakdown">{rows.map(row => <div key={row.label}>
      <dt><span className={`usage-swatch ${row.color ? '' : 'usage-swatch-free'}`} style={row.color ? { background: row.color } : undefined} />{row.label}</dt>
      <dd className="usage-tokens">{formatTokens(row.value)}</dd>
      <dd className="usage-percent">{row.percentLabel ?? '—'}</dd>
    </div>)}</dl>}
    {usage.state === 'unknown' && <p className="detail-footnote">Pi reports context occupancy again after the next completed response. Until then the post-compaction reading stays unknown rather than reusing the size before compaction.</p>}
    {usage.state === 'unreported' && <p className="detail-footnote">Pi has not reported a context window for this session yet.</p>}
  </>;
}

function measureProps(usage: ContextWindowView, meter: boolean) {
  if (!meter) return { role: 'img' as const, 'aria-label': usage.title };
  return {
    role: 'meter' as const,
    'aria-label': 'Context window usage',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': usage.percentNow ?? 0,
    'aria-valuetext': usage.title,
  };
}

/** Whole-session API totals, always kept apart from the context-window occupancy. */
export function ApiUsageRows({ stats }: { stats: SessionStats | null | undefined }) {
  const rows = apiUsageSegments(stats);
  if (rows.length === 0) return <p className="detail-footnote">No API usage reported for this session yet.</p>;
  return <dl className="usage-breakdown">{rows.map(row => <div key={row.label}>
    <dt><span className="usage-swatch" style={{ background: row.color }} />{row.label}</dt>
    <dd className="usage-tokens">{formatTokens(row.value)}</dd>
    <dd className="usage-percent">—</dd>
  </div>)}</dl>;
}
