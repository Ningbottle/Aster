import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { CaretLeft, CaretRight, WarningCircle, X } from '@phosphor-icons/react';
import type { UiImage } from './model';
import { DRAG_DEADZONE, FIT_TRANSFORM, SNAP_MIN_SCALE, WHEEL_SENSITIVITY, fitBox, panTo, zoomAt, type ZoomTransform } from './media-zoom';

/** Base64 stays as Pi stored it; the data URL is only built for display. */
export function imageSource(image: UiImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function Thumb({ image, label, failureLabel, onOpen, buttonRef }: {
  image: UiImage; label: string; failureLabel: string; onOpen: (element: HTMLButtonElement) => void; buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => imageSource(image), [image]);
  if (failed) return <div className="image-thumb is-failed" role="img" aria-label={failureLabel}>
    <WarningCircle size={15} />
    <span>Image unavailable</span>
  </div>;
  return <button type="button" className="image-thumb" aria-label={label}
    ref={buttonRef}
    onClick={event => onOpen(event.currentTarget)}>
    <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
  </button>;
}

export function ImageBlock({ images, tone = 'assistant' }: { images: UiImage[]; tone?: 'assistant' | 'user' }) {
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  if (images.length === 0) return null;
  return <div className={`image-grid ${tone}`}>
    {images.map((image, index) => <Thumb key={index} image={image}
      label={images.length > 1 ? `Open image ${index + 1} of ${images.length}` : 'Open image'}
      failureLabel={images.length > 1 ? `Image ${index + 1} of ${images.length} could not be loaded` : 'Image could not be loaded'}
      onOpen={element => { opener.current = element; setOpen(index); }} />)}
    {open !== null && <ImageLightbox images={images} startIndex={open} onClose={() => setOpen(null)} returnFocus={opener} />}
  </div>;
}

/**
 * Full-size preview. Unzoomed it keeps the source ratio and scrolls very tall
 * images; zoomed in it clips the viewport and pans instead. Focus is restored on
 * close. Zoom physics adapted from Caho1/open-claude-ui, MediaLightboxViewer.tsx.
 */
export function ImageLightbox({ images, startIndex, onClose, returnFocus }: {
  images: UiImage[]; startIndex: number; onClose: () => void; returnFocus: RefObject<HTMLElement | null>;
}) {
  const [index, setIndex] = useState(Math.min(startIndex, images.length - 1));
  const [zoom, setZoom] = useState<ZoomTransform | null>(null);
  const [dragging, setDragging] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; tx: number; ty: number } | null>(null);
  const moved = useRef(false);
  const source = useMemo(() => imageSource(images[index]), [images, index]);
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => { setZoom(null); }, [index]);
  /** Keyboard zoom keeps the frame centred; wheel and click anchor on the pointer. */
  const scaleBy = (factor: number) => {
    const image = picture.current;
    const element = viewport.current;
    if (!image || !element) return;
    const box = fitBox(image, element);
    if (!box) return;
    const current = zoom ?? FIT_TRANSFORM;
    const scale = Math.min(Math.max(current.scale * factor, 1), box.maxScale);
    setZoom(scale <= SNAP_MIN_SCALE ? null : zoomAt(box, current, scale));
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const image = picture.current;
      const box = image ? fitBox(image, element) : null;
      if (!image || !box) return;
      if (event.ctrlKey) {
        event.preventDefault();
        const current = zoom ?? FIT_TRANSFORM;
        const scale = Math.min(Math.max(current.scale * Math.exp(-event.deltaY * WHEEL_SENSITIVITY), 1), box.maxScale);
        setZoom(scale <= SNAP_MIN_SCALE ? null : zoomAt(box, current, scale, { clientX: event.clientX, clientY: event.clientY }));
      } else if (zoom) {
        // Already zoomed in: the wheel pans the frame instead of the page.
        event.preventDefault();
        setZoom(panTo(zoom, zoom.tx - event.deltaX, zoom.ty - event.deltaY));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoom]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); scaleBy(1.25); return; }
      if (event.key === '-') { event.preventDefault(); scaleBy(0.8); return; }
      if (event.key === '0') { event.preventDefault(); setZoom(null); return; }
      if (images.length < 2) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); setIndex(value => (value + 1) % images.length); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(value => (value - 1 + images.length) % images.length); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [images.length, onClose, zoom]);
  useEffect(() => () => { returnFocus.current?.focus(); }, [returnFocus]);
  const toggleZoom = (event: ReactMouseEvent<HTMLImageElement>) => {
    if (moved.current) return;
    if (zoom) { setZoom(null); return; }
    const element = viewport.current;
    const box = element ? fitBox(event.currentTarget, element) : null;
    if (!box) return;
    setZoom(zoomAt(box, FIT_TRANSFORM, box.maxScale, { clientX: event.clientX, clientY: event.clientY }));
  };
  const startDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!zoom || event.button !== 0) return;
    moved.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, tx: zoom.tx, ty: zoom.ty };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    const state = drag.current;
    if (!state || !zoom || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!moved.current && Math.hypot(dx, dy) < DRAG_DEADZONE) return;
    if (!moved.current) { moved.current = true; setDragging(true); }
    setZoom(panTo(zoom, state.tx + dx, state.ty + dy));
  };
  const endDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    // The click that follows this pointerup must not toggle the zoom back off.
    window.setTimeout(() => { moved.current = false; }, 0);
  };
  return <div className="image-lightbox-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="image-lightbox" ref={dialog} role="dialog" aria-modal="true" aria-label={images.length > 1 ? `Image ${index + 1} of ${images.length}` : 'Image preview'}>
      <div className="image-lightbox-bar">
        <span className="image-lightbox-count">{images.length > 1 ? `${index + 1} / ${images.length}` : 'Image'}</span>
        <div className="image-lightbox-actions">
          {zoom && <span className="image-lightbox-zoom">{Math.round(zoom.scale * 100)}%</span>}
          <button type="button" className="image-lightbox-close" aria-label="Close image preview" ref={close} onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className={`image-lightbox-body${zoom ? ' is-zoomed' : ''}${dragging ? ' is-grabbing' : ''}`} ref={viewport}>
        <img className="image-lightbox-image" ref={picture} src={source} alt="" draggable={false}
          style={zoom ? { transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` } : undefined}
          onClick={toggleZoom} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      </div>
      {images.length > 1 && <button type="button" className="image-lightbox-nav prev" aria-label="Previous image" onClick={() => setIndex(value => (value - 1 + images.length) % images.length)}><CaretLeft size={15} /></button>}
      {images.length > 1 && <button type="button" className="image-lightbox-nav next" aria-label="Next image" onClick={() => setIndex(value => (value + 1) % images.length)}><CaretRight size={15} /></button>}
    </div>
  </div>;
}
