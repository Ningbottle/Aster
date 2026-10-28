/** The pdf.js worker bundle is also loaded on the main thread for the preview. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}
