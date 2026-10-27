import { useMemo, useRef, useState } from 'react';
import type { UsageRange, UsageSummary } from '@thinkrail/contracts';
import { formatTokens } from './usage';
import { SkeletonSweep } from './cds/Status';
import './usage-dashboard.css';

type Props = {
  summary: UsageSummary | null;
  range: UsageRange;
  onRangeChange: (range: UsageRange) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

const ranges: { value: UsageRange; label: string }[] = [
  { value: 'all', label: 'All' }, { value: '30d', label: '30d' }, { value: '7d', label: '7d' },
];

export function UsageDashboard({ summary, range, onRangeChange, loading, error, onRefresh }: Props) {
  const [page, setPage] = useState<'overview' | 'models'>('overview');
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const today = summary ? dateInZone(summary.generatedAt, summary.timeZone) : '';
  const heat = useMemo(() => summary ? buildHeatmap(summary, today, range) : [], [summary, today, range]);
  const models = useMemo(() => summary ? [...summary.models].sort((a, b) => b.tokens.total - a.tokens.total) : [], [summary]);
  const activeDay = heat.some(day => day.date === focusedDay && day.state === 'in-range') ? focusedDay : today;
  const metrics = summary ? [
    ['Sessions', summary.sessions.toLocaleString()],
    ['Messages', summary.messages.toLocaleString()],
    ['Total tokens', formatTokens(summary.totalTokens)],
    ['Active days', summary.activeDays.toLocaleString()],
    ['Peak hour', summary.peakHour === null ? '—' : formatHour(summary.peakHour)],
    ['Favorite model', summary.favoriteModel ? shortModel(summary.favoriteModel.provider, summary.favoriteModel.id) : '—'],
  ] : [];

  return <section className="usage-panel" aria-label="Usage statistics">
      <div className="usage-toolbar">
        <div className="usage-tabs" role="tablist" aria-label="Usage views" onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next = page === 'overview' ? 'models' : 'overview';
          setPage(next); tabRefs.current[next === 'overview' ? 0 : 1]?.focus();
        }}>
          {(['overview', 'models'] as const).map((tab, index) => <button id={`usage-tab-${tab}`} key={tab} ref={el => { tabRefs.current[index] = el; }} role="tab" aria-selected={page === tab} aria-controls="usage-panel" tabIndex={page === tab ? 0 : -1} onClick={() => setPage(tab)}>{tab === 'overview' ? 'Overview' : 'Models'}</button>)}
        </div>
        <div className="usage-ranges" role="group" aria-label="Usage range">
          {ranges.map(item => <button key={item.value} aria-pressed={range === item.value} onClick={() => onRangeChange(item.value)}>{item.label}</button>)}
        </div>
      </div>
      <div id="usage-panel" role="tabpanel" aria-labelledby={`usage-tab-${page}`} tabIndex={0} className="usage-content" aria-busy={loading}>
        {error ? <div className="usage-state usage-error"><p>{error}</p><button onClick={onRefresh}>Retry</button></div>
          : loading && !summary ? <div className="usage-skeleton">
            <span className="sr-only">Loading usage…</span>
            <div className="usage-metrics">{Array.from({ length: 6 }, (_, index) => <SkeletonSweep key={index} className="usage-skeleton-metric" />)}</div>
            <SkeletonSweep className="usage-skeleton-heat" />
          </div>
          : !summary ? <div className="usage-state">No usage data available.</div>
          : loading ? <div className="usage-inline-loading">Refreshing…</div>
          : page === 'overview' ? <>
            <div className="usage-metrics">{metrics.map(([label, value]) => <div className="usage-metric" key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>
            <div className="usage-heat-section">
              <div className="sr-only">Daily message activity, past {heat.length / 7} weeks</div>
              <div className="usage-heat-scroll"><div className="usage-heatmap" role="group" aria-label={`Daily message activity for the ${heat.length / 7} weeks through ${today}`} onKeyDown={event => {
                const moves: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-date]'));
                const index = buttons.indexOf(event.target as HTMLButtonElement);
                if (index < 0 || !(event.key in moves || event.key === 'Home' || event.key === 'End')) return;
                event.preventDefault();
                const target = event.key === 'Home' ? buttons.find(button => !button.disabled)
                  : event.key === 'End' ? buttons.findLast(button => !button.disabled) : buttons[index + moves[event.key]];
                if (target && !target.disabled) target.focus();
              }}>
                <div className="usage-weeks">{heat.map(day => {
                  const label = day.state === 'future' ? `${day.date}: future` : day.state === 'out-of-range' ? `${day.date}: outside selected range` : `${day.date}: ${day.messages} messages, ${formatTokens(day.tokens)} tokens`;
                  return <button type="button" key={day.date} data-date={day.date} tabIndex={day.date === activeDay ? 0 : -1} disabled={day.state !== 'in-range'} onFocus={() => setFocusedDay(day.date)} className={`usage-day level-${day.level}${day.state === 'future' ? ' future' : ''}${day.state === 'out-of-range' ? ' out-of-range' : ''}`} title={label} aria-label={label} />;
                })}</div>
              </div></div>
            </div>
          </> : <div className="usage-models-wrap"><table className="usage-models"><thead><tr><th>Model</th><th>Messages</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Total</th></tr></thead><tbody>{models.map(model => <tr key={JSON.stringify([model.provider, model.id])}><th scope="row" title={`${model.provider} / ${model.id}`}>{shortModel(model.provider, model.id)}</th><td>{model.messages.toLocaleString()}</td><td>{formatTokens(model.tokens.input)}</td><td>{formatTokens(model.tokens.output)}</td><td>{formatTokens(model.tokens.cacheRead)}</td><td>{formatTokens(model.tokens.cacheWrite)}</td><td>{formatTokens(model.tokens.total)}</td></tr>)}</tbody></table>{models.length === 0 && <div className="usage-state">No model usage reported for this range.</div>}<p className="usage-total-note">Total = input + output + cache read + cache write.</p></div>}
      </div>
      {summary && <footer className="usage-footer">
        {(summary.coverage.issues.length > 0 || summary.coverage.unreportedResponses > 0) && <p className="usage-coverage" role="status">Partial coverage · {summary.coverage.sessionsRead} sessions checked; {summary.coverage.unreportedResponses} responses without usage{summary.coverage.issues.length ? `; ${summary.coverage.issues.length} unreadable or invalid sources` : ''}.</p>}
        <p title={`Input + output + cache read + cache write; dates use ${summary.timeZone}.`}>Local registered projects · includes cache</p>
      </footer>}
    </section>;
}

function dateInZone(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatHour(hour: number): string {
  const value = hour % 12 || 12;
  return `${value} ${hour < 12 ? 'AM' : 'PM'}`;
}

function shortModel(provider: string, id: string): string { return id || provider || 'Unattributed'; }

export function buildHeatmap(summary: UsageSummary, today: string, range: UsageRange) {
  const daily = new Map(summary.daily.map(day => [day.date, day]));
  const todayDate = new Date(`${today}T00:00:00Z`);
  const earliestHistory = summary.daily.reduce((earliest, day) => day.date < earliest ? day.date : earliest, today);
  const historyDays = Math.max(1, Math.floor((todayDate.getTime() - new Date(`${earliestHistory}T00:00:00Z`).getTime()) / 86_400_000) + 1);
  const weekCount = range === 'all' && historyDays > 26 * 7 ? 52 : 26;
  const rangeStart = new Date(todayDate);
  if (range === '7d') rangeStart.setUTCDate(rangeStart.getUTCDate() - 6);
  if (range === '30d') rangeStart.setUTCDate(rangeStart.getUTCDate() - 29);
  const weekday = (todayDate.getUTCDay() + 6) % 7;
  const end = new Date(todayDate); end.setUTCDate(end.getUTCDate() - weekday + 6);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (weekCount - 1) * 7 - 6);
  const activeMessages = summary.daily.filter(day => day.date >= start.toISOString().slice(0, 10) && day.date <= today && (range === 'all' || day.date >= rangeStart.toISOString().slice(0, 10))).map(day => day.messages);
  const maxMessages = Math.max(0, ...activeMessages);
  const result = [];
  for (let offset = 0; offset < weekCount * 7; offset++) {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + offset);
    const key = date.toISOString().slice(0, 10);
    const row = daily.get(key);
    const tokens = row?.tokens ?? 0;
    const messages = row?.messages ?? 0;
    const future = key > today;
    const inRange = range === 'all' ? key >= earliestHistory : key >= rangeStart.toISOString().slice(0, 10);
    const state = future ? 'future' : inRange ? 'in-range' : 'out-of-range';
    const level = state !== 'in-range' || messages === 0 ? 0 : maxMessages ? Math.min(4, Math.ceil(messages / maxMessages * 4)) : 0;
    result.push({ date: key, tokens, messages, state, level });
  }
  return result;
}
