/*
 * Adapted from Caho1/open-claude-ui, code-examples/StatusIndicators.tsx, MIT,
 * commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * The 6px light and the skeleton sheen ride on theme classes that already ship
 * in cds/theme.css (.status-dot, cds-skeleton-sweep).
 */
export type StatusKind = 'ready' | 'running' | 'error' | 'clay';

/** The dot itself is decorative; the label carries the state for assistive tech. */
export function StatusDot({ kind, label }: { kind: StatusKind; label?: string }) {
  return <span className="status-indicator">
    <span className="status-dot" data-cds="StatusDot" data-kind={kind} aria-hidden="true" />
    {label && <span className="status-indicator-label">{label}</span>}
  </span>;
}

/** 2s 105° sheen; fills a placeholder box while host statistics are read. */
export function SkeletonSweep({ className = '' }: { className?: string }) {
  return <div className={`cds-skeleton ${className}`.trim()} aria-hidden="true"><span className="cds-skeleton-band" /></div>;
}
