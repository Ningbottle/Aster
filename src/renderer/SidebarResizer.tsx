import { useCallback, useEffect, useRef, useState } from 'react';
import { clampSidebarWidth, sidebarWidthForKey, sidebarWidthLimit, SIDEBAR_DEFAULT_WIDTH } from './sidebar-width';

/**
 * Left navigation resize handle. It is a sibling of the navigation content, not
 * of the information rail or the file preview: this width never touches those.
 * Kept from the reference split handle: 4px dead zone, Escape rollback,
 * double-click reset, pointer capture and keyboard stepping.
 */
export function SidebarResizer({ width, onChange, onCommit }: {
  width: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  /** The window can shrink after the user chose a width; the handle owns the
   *  correction so the conversation keeps its minimum either way. */
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);
  const limit = sidebarWidthLimit(viewport);
  const start = useRef<{ x: number; width: number } | null>(null);
  const previous = useRef(width);
  const current = useRef(width);
  current.current = width;

  const endDrag = useCallback((target: HTMLElement | null, pointerId?: number, commit = true) => {
    setDragging(false);
    start.current = null;
    document.body.classList.remove('is-resizing-sidebar');
    if (commit) onCommit(current.current);
    if (target && pointerId !== undefined) {
      try {
        target.releasePointerCapture(pointerId);
      } catch (error) {
        // A pointercancel or window blur can drop the capture before this runs.
        console.warn('The sidebar handle had already lost pointer capture.', error);
      }
    }
  }, [onCommit]);

  useEffect(() => {
    if (!dragging) return;
    const cancel = () => endDrag(document.querySelector<HTMLElement>('.sidebar-resizer'), undefined, false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      onChange(previous.current);
      endDrag(null, undefined, false);
    };
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('is-resizing-sidebar');
    };
  }, [dragging, endDrag, onChange]);

  useEffect(() => {
    const onResize = () => {
      setViewport(window.innerWidth);
      const next = clampSidebarWidth(current.current, window.innerWidth);
      if (next !== current.current) onChange(next);
    };
    window.addEventListener('resize', onResize);
    /** A stored width can already exceed this window on mount. */
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [onChange]);

  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize the navigation; double-click for the default width, arrow keys to adjust and Escape to undo"
    aria-valuemin={limit.min}
    aria-valuemax={limit.max}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    className={`sidebar-resizer ${dragging ? 'is-dragging' : ''}`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      start.current = { x: event.clientX, width };
      previous.current = width;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing-sidebar');
    }}
    onPointerMove={event => {
      const origin = start.current;
      if (!origin) return;
      const delta = event.clientX - origin.x;
      if (Math.abs(delta) < 4) return;
      onChange(clampSidebarWidth(origin.width + delta, window.innerWidth));
    }}
    onPointerUp={event => endDrag(event.currentTarget as HTMLElement, event.pointerId)}
    onPointerCancel={event => endDrag(event.currentTarget as HTMLElement, event.pointerId, false)}
    onLostPointerCapture={() => { if (start.current) endDrag(null, undefined, false); }}
    onDoubleClick={() => onChange(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, window.innerWidth))}
    onKeyDown={event => {
      const next = sidebarWidthForKey(event.key, width, window.innerWidth, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      onChange(next);
      onCommit(next);
    }}
  />;
}
