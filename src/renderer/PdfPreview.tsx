import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';

/** Vite bundles the worker next to the renderer entry and rewrites this URL. */
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

/**
 * pdf.js renders into a canvas because Chromium's built-in viewer needs plugins,
 * which a sandboxed Electron renderer does not load.
 */
export function PdfPreview({ data }: { data: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const task = getDocument({ data: bytes });
    setError(null);
    setPages(0);
    setPage(1);
    void task.promise.then(document => {
      if (!active) return;
      documentRef.current = document;
      setPages(document.numPages);
    }, cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; documentRef.current = null; void task.destroy(); };
  }, [data]);

  useEffect(() => {
    const document = documentRef.current;
    const element = canvas.current;
    if (!document || !element) return;
    let active = true;
    void document.getPage(page).then(async pdfPage => {
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const width = element.parentElement?.clientWidth ?? 280;
      const viewport = pdfPage.getViewport({ scale: Math.max(0.25, (width - 12) / base.width) });
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
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [page, pages]);

  if (error) return <p className="detail-subtle details-preview-note" role="alert">{error}</p>;
  return <div className="pdf-preview">
    <div className="pdf-preview-bar">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>‹</button>
      <span>{page} / {pages || '…'}</span>
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}>›</button>
    </div>
    <div className="pdf-preview-body"><canvas ref={canvas} /></div>
  </div>;
}
