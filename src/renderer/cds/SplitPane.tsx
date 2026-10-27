/*
 * Adapted from Caho1/open-claude-ui, code-examples/ArtifactsSplitPaneResizer.tsx,
 * MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * Kept as shipped: 4px dead-zone, Escape rollback, double-click 50/50, 18% collapse
 * threshold, 380/420 px clamps and the drag shield over the preview pane. The only
 * additions are a controlled `collapsed` prop and non-scrolling pane bodies, because
 * both panes own their scroll containers.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function SplitPane({ leftPane, rightPane, collapsed, onCollapsedChange, initialSplitRatio = 0.55, minLeftWidth = 380, minRightWidth = 420, collapseThreshold = 0.18 }: {
  leftPane: ReactNode;
  rightPane: ReactNode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  initialSplitRatio?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
  collapseThreshold?: number;
}) {
  const [splitRatio, setSplitRatio] = useState(initialSplitRatio);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; ratio: number } | null>(null);
  const previousRatioRef = useRef(initialSplitRatio);

  const handleDoubleClick = useCallback(() => {
    onCollapsedChange(false);
    setSplitRatio(0.5);
  }, [onCollapsedChange]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerStartRef.current = { x: event.clientX, ratio: splitRatio };
    previousRatioRef.current = splitRatio;
    setDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!dragging || !pointerStartRef.current || !containerRef.current) return;
    const width = containerRef.current.offsetWidth;
    if (width <= 0) return;
    const delta = event.clientX - pointerStartRef.current.x;
    if (Math.abs(delta) < 4 && pointerStartRef.current.x !== 0) return;
    const raw = pointerStartRef.current.ratio + delta / width;
    if (raw > 1 - collapseThreshold) {
      onCollapsedChange(true);
      setSplitRatio(1);
      return;
    }
    onCollapsedChange(false);
    const minRatio = minLeftWidth / width;
    const maxRatio = (width - minRightWidth) / width;
    setSplitRatio(Math.max(minRatio, Math.min(maxRatio, raw)));
  }, [collapsed, collapseThreshold, dragging, minLeftWidth, minRightWidth, onCollapsedChange]);

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    pointerStartRef.current = null;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // Some browsers throw when the pointer was already released.
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dragging || event.key !== 'Escape') return;
      setDragging(false);
      onCollapsedChange(false);
      setSplitRatio(previousRatioRef.current);
      pointerStartRef.current = null;
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dragging, onCollapsedChange]);
  /** Reopening from the title bar must not restore the 100% width left by a collapse drag. */
  useEffect(() => {
    if (collapsed) return;
    setSplitRatio(value => (value >= 1 ? (previousRatioRef.current > 0 && previousRatioRef.current < 1 ? previousRatioRef.current : 0.55) : value));
  }, [collapsed]);

  return <div
    ref={containerRef}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    data-pane-dragging={dragging ? 'true' : undefined}
    className="split-pane relative flex w-full h-full overflow-hidden select-none"
    style={{ ['--df-pane-row' as string]: `${splitRatio}` }}
  >
    <div className="h-full overflow-hidden flex flex-col transition-all duration-75" style={{ width: collapsed ? '100%' : `${splitRatio * 100}%` }}>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{leftPane}</div>
    </div>

    {!collapsed && <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-valuenow={Math.round(splitRatio * 100)}
      aria-label="Resize the preview pane; double-click for 50/50 and Escape to restore"
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      className={`group relative z-30 flex items-center justify-center w-2 -mx-1 cursor-col-resize outline-none touch-none transition-colors ${dragging ? 'bg-[var(--cds-fill-brand,#d97757)]/20' : 'hover:bg-[var(--cds-fill-brand,#d97757)]/10'}`}
    >
      <div className={`w-[1px] h-full transition-colors ${dragging ? 'bg-[var(--cds-fill-brand,#d97757)]' : 'bg-[var(--cds-border-subtle,#e5e5e3)] group-hover:bg-[var(--cds-fill-brand,#d97757)]'}`} />
      <div className={`absolute size-4 rounded-full flex items-center justify-center bg-[var(--cds-bg-surface,#ffffff)] border border-[var(--cds-border-subtle,#e0e0de)] shadow-xs transition-transform ${dragging ? 'scale-110 border-[var(--cds-fill-brand,#d97757)]' : 'group-hover:scale-105'}`}>
        <div className="flex gap-0.5">
          <span className="w-0.5 h-1.5 rounded-full bg-[var(--cds-text-muted,#8c8c8c)]" />
          <span className="w-0.5 h-1.5 rounded-full bg-[var(--cds-text-muted,#8c8c8c)]" />
        </div>
      </div>
    </div>}

    {!collapsed && <div
      className="relative h-full overflow-hidden flex flex-col transition-all duration-75 border-l border-[var(--cds-border-subtle,#e5e5e3)] bg-[var(--cds-bg-surface,#ffffff)]"
      style={{ width: `${(1 - splitRatio) * 100}%` }}
    >
      {dragging && <div className="absolute inset-0 z-50 pointer-events-none bg-transparent" />}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{rightPane}</div>
    </div>}
  </div>;
}
