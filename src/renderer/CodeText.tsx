import { useEffect, useState } from 'react';
import { highlight, type CodeToken } from './syntax';

interface HighlightState {
  text: string;
  language: string | null;
  tokens: CodeToken[];
}

/** Streaming text keeps updating; tokenizing waits for a short pause so a delta never re-highlights the full history. */
const STABLE_DELAY_MS = 120;

/**
 * Renders tokenized code as React text nodes. No HTML string is produced, so
 * tool output and file contents cannot inject markup through highlighting.
 */
export function CodeText({ text, language }: { text: string; language: string | null }) {
  const [state, setState] = useState<HighlightState>(() => ({ text, language, tokens: highlight(text, language) }));
  useEffect(() => {
    if (state.text === text && state.language === language) return;
    const timer = setTimeout(() => setState({ text, language, tokens: highlight(text, language) }), STABLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, language, state]);
  // While a block is still changing, show its full current text instead of stale tokens.
  if (state.text !== text || state.language !== language) return text;
  const tokens = state.tokens;
  if (tokens.length === 1 && tokens[0].kind === 'plain') return text;
  return tokens.map((token, index) => token.kind === 'plain'
    ? token.text
    : <span key={index} className={`tok-${token.kind}`}>{token.text}</span>);
}
