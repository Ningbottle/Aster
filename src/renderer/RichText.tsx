import { Children, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import { CodeText } from './CodeText';
import { CopyButton } from './CopyButton';
import { MAX_HIGHLIGHT_LENGTH } from './syntax';

/**
 * GFM first, then the CJK-friendly parse rules: CommonMark does not close `**`
 * when the character inside is a CJK punctuation mark and the character outside
 * is ordinary text, so `**优先级建议：**编程基础` stayed literal. The plugin is
 * parse-only and does not touch raw HTML or the stored message.
 */
const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly];

function safeLinkUrl(href: string | undefined): string | null {
  if (!href) return null;
  const value = href.trim();
  return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(value) ? value : null;
}

function isLocalReference(href: string): boolean {
  return !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href.trim());
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  return <div className="code-block">
    <div className="code-block-head">
      <span className="code-block-lang">{language ?? 'code'}</span>
      <CopyButton text={code} label="Copy code" className="code-copy" iconSize={14} />
    </div>
    {code.length > MAX_HIGHLIGHT_LENGTH && <p className="code-block-note" role="note">Large block shown as plain text; syntax highlighting stops at 120k characters.</p>}
    <pre><code className={language ? `language-${language}` : undefined}><CodeText text={code} language={language} /></code></pre>
  </div>;
}

interface ReferenceActions {
  onOpenFile?: (path: string) => void;
  onOpenExternal?: (url: string) => void;
}

const ReferenceContext = createContext<ReferenceActions>({});

function MarkdownLink({ href, children, node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  const { onOpenFile, onOpenExternal } = useContext(ReferenceContext);
  const url = safeLinkUrl(href);
  if (url) {
    return <a {...props} href={url} title={url} onClick={event => { event.preventDefault(); onOpenExternal?.(url); }} onAuxClick={event => event.preventDefault()}>
      {children}
    </a>;
  }
  if (href && isLocalReference(href)) {
    return <a {...props} href={href} className="local-file-reference" title={href} onClick={event => { event.preventDefault(); onOpenFile?.(href); }}>
      {children}
    </a>;
  }
  return <span title={href || undefined}>{children}</span>;
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children).find(isValidElement<{ className?: string; children?: ReactNode }>);
  const language = /language-([\w+-]+)/.exec(child?.props.className ?? '')?.[1] ?? null;
  return <CodeBlock code={textOf(child?.props.children ?? children)} language={language} />;
}

function MarkdownImage({ alt }: { alt?: string }) {
  return <span role="img" aria-label={alt || 'Image'}>{alt || 'Image'}</span>;
}

// ReactMarkdown treats these as component types. Keep their identity across scroll,
// stream and parent renders so code-block state and focused links stay mounted.
const MARKDOWN_COMPONENTS: Components = { a: MarkdownLink, pre: MarkdownPre, img: MarkdownImage };

export function RichText({ text, onOpenFile, onOpenExternal }: { text: string } & ReferenceActions) {
  return <ReferenceContext.Provider value={{ onOpenFile, onOpenExternal }}>
    <div className="rich-text"><ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown></div>
  </ReferenceContext.Provider>;
}
