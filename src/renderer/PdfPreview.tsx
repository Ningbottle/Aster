import { useEffect, useRef, useState } from 'react';
import { ArrowsOutSimple } from '@phosphor-icons/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const RENDER_TIMEOUT = 8000;

type Pdfjs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<Pdfjs> | null = null;

/**
 * A module worker accepts the script but never answers inside this sandboxed
 * renderer, so pdf.js waits on an empty canvas forever. Loading its worker
 * module on the main thread and publishing it the way pdf.js expects gives the
 * library a working message handler without a real Worker.
 */
function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs') as Promise<{ WorkerMessageHandler?: unknown }>,
      ]);
      if (worker.WorkerMessageHandler) {
        (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
      }
      return pdfjs as unknown as Pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function createPdfDocument(data: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const nativeWorker = window.Worker;
  (window as unknown as { Worker?: typeof Worker }).Worker = undefined;
  try {
    return pdfjs.getDocument({ data });
  } finally {
    window.Worker = nativeWorker;
  }
}

/**
 * pdf.js renders into a canvas because Chromium's built-in viewer needs plugins,
 * which a sandboxed Electron renderer does not load. Zoom is relative to a
 * fit-to-width baseline, so the first page always lands inside the panel.
 */
export function PdfPreview({ data, onOpenFile }: { data: string; onOpenFile?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setPages(0);
    setPage(1);
    setZoom(1);
    const timer = window.setTimeout(() => {
      if (active) setError('This PDF could not be rendered in the preview. Open it in the system editor instead.');
    }, RENDER_TIMEOUT);
    void (async () => {
      try {
        const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
        const task = await createPdfDocument(bytes);
        taskRef.current = task;
        const document = await task.promise;
        if (!active) return;
        window.clearTimeout(timer);
        documentRef.current = document;
        setPages(document.numPages);
      } catch (cause) {
        if (!active) return;
        window.clearTimeout(timer);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timer);
      documentRef.current = null;
      const task = taskRef.current;
      taskRef.current = null;
      void task?.destroy();
    };
  }, [data]);

  /** The panel can be resized by the split handle; fit-to-width must follow it. */
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(240, element.clientWidth - 24));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const document = documentRef.current;
    const element = canvas.current;
    if (!document || !element || width === 0) return;
    let active = true;
    setRendering(true);
    void document.getPage(page).then(async pdfPage => {
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: (width / base.width) * zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.floor(viewport.width * ratio);
      element.height = Math.floor(viewport.height * ratio);
      element.style.width = `${Math.floor(viewport.width)}px`;
      element.style.height = `${Math.floor(viewport.height)}px`;
      await pdfPage.render({
        canvas: element,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      }).promise;
      if (active) setRendering(false);
    }).catch(cause => {
      if (!active) return;
      setRendering(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [page, pages, zoom, width]);

  if (error) return <p className="detail-subtle details-preview-note" role="alert">{error}</p>;
  return <div className="pdf-preview">
    <div className="pdf-preview-bar">
      <div className="pdf-preview-group">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>‹</button>
        <span className="pdf-page-count" aria-live="polite">{page} / {pages || '…'}</span>
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}>›</button>
      </div>
      <div className="pdf-preview-group">
        <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(value => Math.max(MIN_ZOOM, Math.round((value - 0.1) * 10) / 10))}>−</button>
        <span className="pdf-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(value => Math.min(MAX_ZOOM, Math.round((value + 0.1) * 10) / 10))}>+</button>
        <button type="button" className="pdf-fit" aria-label="Fit to width" title="Fit to width" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit</button>
        {onOpenFile && <button type="button" className="pdf-open" aria-label="Open in the system editor" title="Open in the system editor" onClick={onOpenFile}><ArrowsOutSimple size={13} /></button>}
      </div>
    </div>
    <div className={'pdf-preview-body' + (rendering ? ' is-rendering' : '')} ref={frame}>
      <canvas ref={canvas} />
      {rendering && pages > 0 && <span className="pdf-rendering" role="status">Rendering page {page}…</span>}
    </div>
  </div>;
}
