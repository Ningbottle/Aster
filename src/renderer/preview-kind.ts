/**
 * The details panel previews files by kind: images and PDFs travel as base64,
 * text keeps its columns, and markdown renders. Pure so the panel only owns IO.
 */
export type PreviewKind = 'image' | 'pdf' | 'markdown' | 'html' | 'text' | 'binary';

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'mdx']);
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'htm']);

export function extensionOf(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').pop() ?? path;
  const cut = name.lastIndexOf('.');
  return cut <= 0 ? '' : name.slice(cut + 1).toLowerCase();
}

/** Image and PDF previews need bytes; everything else reads as text. */
export function needsBinary(path: string): boolean {
  const extension = extensionOf(path);
  return IMAGE_EXTENSIONS.has(extension) || extension === 'pdf';
}

export function previewKind(path: string, text: boolean): PreviewKind {
  const extension = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (!text) return 'binary';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  return MARKDOWN_EXTENSIONS.has(extension) ? 'markdown' : 'text';
}
