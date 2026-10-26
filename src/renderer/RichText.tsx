import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from '@phosphor-icons/react';
import { CdsButton as Button } from './cds/Button';

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
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }, () => setCopied(false));
  }
  return <div className="code-block">
    <div className="code-block-head">
      <span className="code-block-lang">{language ?? 'code'}</span>
      <Button variant="ghost" size="icon" className="code-copy" aria-label={copied ? 'Code copied' : 'Copy code'} title={copied ? 'Copied' : 'Copy code'} onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
    <pre><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
  </div>;
}

export function RichText({ text, onOpenFile, onOpenExternal }: {
  text: string;
  onOpenFile?: (path: string) => void;
  onOpenExternal?: (url: string) => void;
}) {
  const components: Components = {
    a({ href, children, node: _node, ...props }) {
      const url = safeLinkUrl(href);
      if (url) {
        return (
          <a {...props} href={url} title={url} onClick={event => { event.preventDefault(); onOpenExternal?.(url); }} onAuxClick={event => event.preventDefault()}>
            {children}
          </a>
        );
      }
      if (href && isLocalReference(href)) {
        return (
          <a {...props} href={href} className="local-file-reference" title={href} onClick={event => { event.preventDefault(); onOpenFile?.(href); }}>
            {children}
          </a>
        );
      }
      return <span title={href || undefined}>{children}</span>;
    },
    pre({ children, node: _node, ...props }) {
      const child = Children.toArray(children).find(isValidElement<{ className?: string; children?: ReactNode }>);
      const language = /language-([\w+-]+)/.exec(child?.props.className ?? '')?.[1] ?? null;
      return <CodeBlock code={textOf(child?.props.children ?? children)} language={language} />;
    },
    img({ alt }) {
      return <span role="img" aria-label={alt || 'Image'}>{alt || 'Image'}</span>;
    },
  };
  return <div className="rich-text"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{text}</ReactMarkdown></div>;
}
