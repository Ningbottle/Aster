/**
 * PrismJS (MIT, 1.30.0) tokenizes code into a typed token stream; Aster renders
 * that stream as React text nodes, never as an HTML string, so file contents and
 * tool output cannot inject markup. Languages are registered on demand; unknown
 * languages and very long blocks stay plain instead of being guessed or dropped.
 */
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-powershell.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-markdown.js';

export type TokenKind =
  | 'plain' | 'comment' | 'string' | 'number' | 'boolean' | 'keyword' | 'function'
  | 'property' | 'tag' | 'builtin' | 'operator' | 'punctuation' | 'regex'
  | 'variable' | 'strong' | 'emphasis' | 'inserted' | 'deleted';

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

/** Long outputs stay readable as plain text instead of building thousands of spans. */
export const MAX_HIGHLIGHT_LENGTH = 120_000;
const CACHE_LIMIT = 64;

/** Fence labels map to the Prism grammar actually registered above. */
const GRAMMARS: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx', typescript: 'typescript',
  json: 'json', jsonc: 'json',
  py: 'python', python: 'python', python3: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash',
  powershell: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown',
};

/** Prism token types collapse onto the small palette the UI actually styles. */
const KIND_ALIASES: Record<string, TokenKind> = {
  comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment',
  string: 'string', char: 'string', 'attr-value': 'string', url: 'string',
  number: 'number', constant: 'number', symbol: 'number', boolean: 'boolean',
  keyword: 'keyword', atrule: 'keyword', important: 'keyword', rule: 'keyword',
  function: 'function', 'class-name': 'function',
  property: 'property', selector: 'property', 'attr-name': 'property', namespace: 'property',
  tag: 'tag', builtin: 'builtin', variable: 'variable', regex: 'regex',
  operator: 'operator', punctuation: 'punctuation',
  title: 'keyword', bold: 'strong', italic: 'emphasis',
  inserted: 'inserted', deleted: 'deleted',
};

const cache = new Map<string, CodeToken[]>();

function push(tokens: CodeToken[], text: string, kind: TokenKind): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ text, kind });
}

/** Raw strings inherit the nearest token colour, matching Prism's nested markup. */
function flatten(stream: Prism.TokenStream, inherited: TokenKind, tokens: CodeToken[]): void {
  const items = Array.isArray(stream) ? stream : [stream];
  for (const item of items) {
    if (typeof item === 'string') {
      push(tokens, item, inherited);
      continue;
    }
    const kind = KIND_ALIASES[item.type] ?? inherited;
    flatten(item.content, kind, tokens);
  }
}

export function highlight(text: string, language: string | null): CodeToken[] {
  const grammarId = language ? GRAMMARS[language.toLowerCase()] : null;
  const grammar = grammarId ? Prism.languages[grammarId] : null;
  if (!grammar || text.length > MAX_HIGHLIGHT_LENGTH) return [{ text, kind: 'plain' }];
  const key = `${grammarId}\u0000${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const tokens: CodeToken[] = [];
  try {
    flatten(Prism.tokenize(text, grammar), 'plain', tokens);
  } catch (error) {
    // A malformed grammar must not hide the code; the original text is kept.
    console.warn(`Prism could not tokenize ${grammarId ?? 'this language'}; showing plain text.`, error);
    return [{ text, kind: 'plain' }];
  }
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, tokens);
  return tokens;
}
