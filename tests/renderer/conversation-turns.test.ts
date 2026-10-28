import { describe, expect, it } from 'vitest';
import { turnMetaIndexes } from '../../src/renderer/conversation-turns';
import type { UiMessage } from '../../src/renderer/model';

const user = (text: string): UiMessage => ({ role: 'user', timestamp: 1, content: [{ type: 'text', text }] });
const text = (value: string): UiMessage => ({ role: 'assistant', timestamp: 2, content: [{ type: 'text', text: value }] });
const tool = (): UiMessage => ({ role: 'assistant', timestamp: 3, content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }] });
const result = (): UiMessage => ({ role: 'toolResult', timestamp: 4, toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: 'ok' }] });

describe('turn timeline ownership', () => {
  it('keeps one timeline on the last text-bearing message of a turn with tools', () => {
    const owners = turnMetaIndexes([user('go'), text('first'), tool(), result(), text('second')]);

    expect([...owners]).toEqual([4]);
  });

  it('gives a tool-only turn no timeline at all', () => {
    expect(turnMetaIndexes([user('go'), tool(), result()]).size).toBe(0);
  });

  it('gives every turn its own timeline', () => {
    const owners = turnMetaIndexes([user('a'), tool(), text('one'), user('b'), text('two'), tool()]);

    expect([...owners].sort()).toEqual([2, 4]);
  });

  it('ignores blank text when choosing the owner', () => {
    const owners = turnMetaIndexes([user('go'), text('answer'), text('   ')]);

    expect([...owners]).toEqual([1]);
  });
});
