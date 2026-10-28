/*
 * Adapted from Caho1/open-claude-ui, code-examples/ArtifactsSplitPaneResizer.tsx,
 * MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * The split now drives only the file preview: the information cards are a fixed
 * column inside the left pane. Kept from the source: 4px dead-zone before a drag
 * starts, Escape rollback, double-click reset and pointer capture. Deliberately
 * not kept: the 18% edge collapse (Aster closes the preview explicitly) and the
 * floating round handle (the boundary itself is the affordance).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { clampRatio, ratioBounds, SPLIT_HANDLE_WIDTH } from '../layout-metrics';

export function SplitPane({ leftPane, rightPane, ratio, onRatioChange, onRatioCommit, cardsInline, label }: {
  leftPane: ReactNode;
  rightPane: ReactNode;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  /** Called once when a change settles, so it can be stored without a write per drag frame. */
  onRatioCommit: (ratio: number) => void;
  /** True while the fixed card column shares the left pane and its minimum width. */
  cardsInline: boolean;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; ratio: number } | null>(null);
  const previousRatioRef = useRef(ratio);
  /** Mirror of the controlled ratio so the resize observer does not re-subscribe per drag frame. */
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const [dragging, setDragging] = useState(false);

  const usableWidth = () => Math.max(0, (containerRef.current?.clientWidth ?? 0) - SPLIT_HANDLE_WIDTH);

  /** Window resizes can leave the stored ratio outside the current min/max pair. */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const clampToContainer = () => {
      const width = element.clientWidth;
      if (!ratioBounds(width, cardsInline)) return;
      const next = clampRatio(ratioRef.current, width, cardsInline);
      if (Math.abs(next - ratioRef.current) > 0.001) onRatioChange(next);
    };
    clampToContainer();
    const observer = new ResizeObserver(clampToContainer);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardsInline, onRatioChange]);

  const endDrag = useCallback((target: HTMLElement | null, pointerId?: number) => {
    setDragging(false);
    pointerStartRef.current = null;
    document.body.classList.remove('is-resizing-pane');
    if (target && pointerId !== undefined) {
      try {
        target.releasePointerCapture(pointerId);
      } catch (error) {
        // The capture may already be gone after pointercancel or a window blur.
        console.warn('The split handle had already lost pointer capture.', error);
      }
    }
  }, []);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerStartRef.current = { x: event.clientX, ratio };
    previousRatioRef.current = ratio;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-pane');
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const start = pointerStartRef.current;
    if (!dragging || !start) return;
    const panes = usableWidth();
    if (panes <= 0) return;
    const delta = event.clientX - start.x;
    if (Math.abs(delta) < 4 && start.x !== 0) return;
    onRatioChange(clampRatio(start.ratio + delta / panes, containerRef.current?.clientWidth ?? 0, cardsInline));
  };

  const finishDrag = (event: React.PointerEvent) => {
    if (!dragging) return;
    endDrag(event.currentTarget as HTMLElement, event.pointerId);
    onRatioCommit(ratioRef.current);
  };

  /** A keyboard or double-click change is already final, so it is stored right away. */
  const applyRatio = (next: number) => {
    onRatioChange(next);
    onRatioCommit(next);
  };

  /** Losing the pointer or the window must not leave the layout in a drag state. */
  useEffect(() => {
    if (!dragging) return;
    const cancel = (commit: number) => {
      endDrag(containerRef.current?.querySelector<HTMLElement>('.split-handle') ?? null);
      onRatioCommit(commit);
    };
    const onCancel = () => cancel(ratioRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const previous = previousRatioRef.current;
      onRatioChange(previous);
      cancel(previous);
    };
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('is-resizing-pane');
    };
  }, [dragging, endDrag, onRatioChange, onRatioCommit]);

  const step = (direction: -1 | 1, coarse: boolean) => {
    if (usableWidth() <= 0) return;
    applyRatio(clampRatio(ratio + direction * (coarse ? 0.08 : 0.02), containerRef.current?.clientWidth ?? 0, cardsInline));
  };

  const handleSeparatorKeyDown = (event: React.KeyboardEvent) => {
    const bounds = ratioBounds(containerRef.current?.clientWidth ?? 0, cardsInline);
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1, event.shiftKey); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1, event.shiftKey); }
    else if (event.key === 'Home' && bounds) { event.preventDefault(); applyRatio(bounds.min); }
    else if (event.key === 'End' && bounds) { event.preventDefault(); applyRatio(bounds.max); }
    else if (event.key === 'Enter') { event.preventDefault(); applyRatio(clampRatio(0.5, containerRef.current?.clientWidth ?? 0, cardsInline)); }
  };

  return <div ref={containerRef} className={`split-pane ${dragging ? 'is-dragging' : ''}`} data-pane-dragging={dragging ? 'true' : undefined}>
    <div className="split-left" style={{ width: `calc((100% - ${SPLIT_HANDLE_WIDTH}px) * ${ratio})` }}>{leftPane}</div>
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((1 - ratio) * 100)}
      className="split-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => { if (dragging) { endDrag(null); onRatioCommit(ratioRef.current); } }}
      onDoubleClick={() => applyRatio(clampRatio(0.5, containerRef.current?.clientWidth ?? 0, cardsInline))}
      onKeyDown={handleSeparatorKeyDown}
    />
    <div className="split-right" style={{ width: `calc((100% - ${SPLIT_HANDLE_WIDTH}px) * ${1 - ratio})` }}>
      {rightPane}
      {dragging && <div className="split-shield" aria-hidden="true" />}
    </div>
  </div>;
}
