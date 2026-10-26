import type { ComponentType } from 'react';
import { FileCode, FileCss, FileDoc, FileJs, FilePdf, FilePy, FileRs, FileTs, FileZip, FileText, GlobeSimple, ImageSquare, TerminalWindow } from '@phosphor-icons/react';

const EXTENSIONS: Record<string, ComponentType<{ size?: number }>> = {
  ts: FileTs, tsx: FileTs,
  js: FileJs, jsx: FileJs, mjs: FileJs, cjs: FileJs,
  css: FileCss, scss: FileCss,
  html: GlobeSimple, htm: GlobeSimple,
  json: FileCode,
  yaml: FileText, yml: FileText, toml: FileText,
  md: FileText, mdx: FileText,
  txt: FileText,
  py: FilePy,
  rs: FileRs,
  go: FileCode,
  java: FileCode,
  sh: TerminalWindow, bash: TerminalWindow, zsh: TerminalWindow, bat: TerminalWindow, cmd: TerminalWindow, ps1: TerminalWindow,
  png: ImageSquare, jpg: ImageSquare, jpeg: ImageSquare, gif: ImageSquare, webp: ImageSquare,
  svg: GlobeSimple,
  pdf: FilePdf,
  zip: FileZip,
  doc: FileDoc, docx: FileDoc,
};

/** Monochrome file glyph; colour belongs to the surrounding row, not to the icon tile. */
export function FileIcon({ path, size = 16 }: { path: string; size?: number }) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const Icon = EXTENSIONS[extension] ?? FileText;
  return <span className="file-icon" aria-hidden="true"><Icon size={size} /></span>;
}
