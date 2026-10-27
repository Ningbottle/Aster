import { describe, expect, test } from 'vitest';
import { dismissesCommandMenu, isComposingKey, submitsMessage, type ComposerKey } from '../../src/renderer/composer-keys';

function key(overrides: Partial<ComposerKey> = {}): ComposerKey {
  return { key: 'Escape', shiftKey: false, isComposing: false, keyCode: 27, ...overrides };
}

describe('composer key guards', () => {
  test('Enter sends only outside composition and without Shift', () => {
    expect(submitsMessage(key({ key: 'Enter', keyCode: 13 }), false)).toBe(true);
    expect(submitsMessage(key({ key: 'Enter', keyCode: 13 }), true)).toBe(false);
    expect(submitsMessage(key({ key: 'Enter', keyCode: 229 }), false)).toBe(false);
    expect(submitsMessage(key({ key: 'Enter', keyCode: 13, isComposing: true }), false)).toBe(false);
    expect(submitsMessage(key({ key: 'Enter', keyCode: 13, shiftKey: true }), false)).toBe(false);
  });

  test('Escape closes the slash panel only outside composition', () => {
    expect(dismissesCommandMenu(key(), false, true)).toBe(true);
    expect(dismissesCommandMenu(key(), true, true)).toBe(false);
    expect(dismissesCommandMenu(key({ keyCode: 229 }), false, true)).toBe(false);
    expect(dismissesCommandMenu(key({ isComposing: true }), false, true)).toBe(false);
    expect(dismissesCommandMenu(key(), false, false)).toBe(false);
  });

  test('either IME signal is enough to protect the draft', () => {
    expect(isComposingKey(key({ isComposing: true }), false)).toBe(true);
    expect(isComposingKey(key({ keyCode: 229 }), false)).toBe(true);
    expect(isComposingKey(key(), true)).toBe(true);
    expect(isComposingKey(key({ keyCode: 13 }), false)).toBe(false);
  });
});
