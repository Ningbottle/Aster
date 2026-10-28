import type { UiMessage } from './model';

/**
 * A Pi turn can emit several assistant messages while tools run between them.
 * The timeline is a property of the turn, so only its last text-bearing
 * assistant message keeps one; a turn that only ran tools keeps none.
 */
export function turnMetaIndexes(messages: readonly UiMessage[]): Set<number> {
  const owners = new Set<number>();
  let pending = -1;
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      if (pending >= 0) owners.add(pending);
      pending = -1;
    } else if (message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text.trim() !== '')) {
      pending = index;
    }
  }
  if (pending >= 0) owners.add(pending);
  return owners;
}
