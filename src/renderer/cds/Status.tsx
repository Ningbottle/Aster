/*
 * Adapted from Caho1/open-claude-ui, code-examples/StatusIndicators.tsx, MIT,
 * commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * The 6px light uses the status-dot class in cds/theme.css.
 */
export type StatusKind = 'ready' | 'running' | 'error' | 'clay';

/** The dot itself is decorative; the label carries the state for assistive tech. */
export function StatusDot({ kind, label }: { kind: StatusKind; label?: string }) {
  return <span className="status-indicator">
    <span className="status-dot" data-cds="StatusDot" data-kind={kind} aria-hidden="true" />
    {label && <span className="status-indicator-label">{label}</span>}
  </span>;
}

// Keep the existing import path available to consumers of the original sweep.
export { SkeletonSweep } from './Skeleton';
