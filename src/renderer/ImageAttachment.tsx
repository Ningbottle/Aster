import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CaretLeft, CaretRight, WarningCircle, X } from '@phosphor-icons/react';
import type { UiImage } from './model';

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

/** Full-size preview: keeps the source ratio, scrolls very tall images, and restores focus on close. */
export function ImageLightbox({ images, startIndex, onClose, returnFocus }: {
  images: UiImage[]; startIndex: number; onClose: () => void; returnFocus: RefObject<HTMLElement | null>;
}) {
  const [index, setIndex] = useState(Math.min(startIndex, images.length - 1));
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const source = useMemo(() => imageSource(images[index]), [images, index]);
  useEffect(() => { close.current?.focus(); }, []);
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
      if (images.length < 2) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); setIndex(value => (value + 1) % images.length); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(value => (value - 1 + images.length) % images.length); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [images.length, onClose]);
  useEffect(() => () => { returnFocus.current?.focus(); }, [returnFocus]);
  return <div className="image-lightbox-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="image-lightbox" ref={dialog} role="dialog" aria-modal="true" aria-label={images.length > 1 ? `Image ${index + 1} of ${images.length}` : 'Image preview'}>
      <div className="image-lightbox-bar">
        <span className="image-lightbox-count">{images.length > 1 ? `${index + 1} / ${images.length}` : 'Image'}</span>
        <button type="button" className="image-lightbox-close" aria-label="Close image preview" ref={close} onClick={onClose}><X size={16} /></button>
      </div>
      <div className="image-lightbox-body">
        <img className="image-lightbox-image" src={source} alt="" />
      </div>
      {images.length > 1 && <button type="button" className="image-lightbox-nav prev" aria-label="Previous image" onClick={() => setIndex(value => (value - 1 + images.length) % images.length)}><CaretLeft size={15} /></button>}
      {images.length > 1 && <button type="button" className="image-lightbox-nav next" aria-label="Next image" onClick={() => setIndex(value => (value + 1) % images.length)}><CaretRight size={15} /></button>}
    </div>
  </div>;
}
