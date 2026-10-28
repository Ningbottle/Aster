import { describe, expect, it } from 'vitest';
import { highlight } from '../../src/renderer/syntax';

const kinds = (text: string, language: string | null) => highlight(text, language).map(token => `${token.kind}:${token.text}`);

describe('code tokenizer', () => {
  it('separates keywords, strings, numbers and comments for TypeScript', () => {
    const tokens = kinds('const answer = 42; // real', 'ts');
    expect(tokens).toContain('keyword:const');
    expect(tokens).toContain('number:42');
    expect(tokens).toContain('comment:// real');
  });

  it('keeps the source text intact', () => {
    const source = 'const text = "a\\"b";\nreturn text;';
    expect(highlight(source, 'ts').map(token => token.text).join('')).toBe(source);
  });

  it('handles python comments and shell strings', () => {
    expect(kinds('def run():\n    return 1  # done', 'python')).toEqual(expect.arrayContaining(['keyword:def', 'comment:# done']));
    expect(kinds('cd "quoted path" && echo ok', 'bash')).toEqual(expect.arrayContaining(['string:"quoted path"', 'builtin:echo']));
  });

  it('colors markup, stylesheets, JSON and Markdown fences', () => {
    const html = kinds('<a href="#">x</a>', 'html');
    expect(html).toEqual(expect.arrayContaining(['property:href', 'string:#']));
    expect(html.some(token => token.startsWith('tag:a'))).toBe(true);
    expect(kinds('.a { color: red; }', 'css')).toEqual(expect.arrayContaining(['property:.a', 'property:color']));
    expect(kinds('{"ok": true, "n": 2}', 'json')).toEqual(expect.arrayContaining(['property:"ok"', 'boolean:true', 'number:2']));
    expect(kinds('# Title\n\n**bold**', 'markdown')).toEqual(expect.arrayContaining(['keyword: Title', 'strong:bold']));
  });

  it('keeps nested markup text byte-for-byte', () => {
    const source = '<a href="#">x</a>';
    expect(highlight(source, 'html').map(token => token.text).join('')).toBe(source);
  });

  it('leaves unknown languages and very long text plain', () => {
    expect(highlight('plain text', null)).toEqual([{ text: 'plain text', kind: 'plain' }]);
    const long = 'a'.repeat(120_001);
    expect(highlight(long, 'ts')).toEqual([{ text: long, kind: 'plain' }]);
  });

  it('returns the same cached token list for repeated input', () => {
    expect(highlight('const a = 1;', 'js')).toBe(highlight('const a = 1;', 'js'));
  });
});
