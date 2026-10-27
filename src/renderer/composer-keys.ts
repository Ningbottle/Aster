export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

/**
 * Windows IME may report keyCode 229 without isComposing, so both signals are required.
 * Shared by Enter and Escape: a candidate-list key must never edit or send the draft.
 */
export function isComposingKey(event: ComposerKey, composing: boolean): boolean {
  return composing || event.isComposing || event.keyCode === 229;
}

export function submitsMessage(event: ComposerKey, composing: boolean): boolean {
  return event.key === 'Enter' && !event.shiftKey && !isComposingKey(event, composing);
}

/** Escape only closes the slash panel; it never rewrites the draft. */
export function dismissesCommandMenu(event: ComposerKey, composing: boolean, menuOpen: boolean): boolean {
  return event.key === 'Escape' && menuOpen && !isComposingKey(event, composing);
}
