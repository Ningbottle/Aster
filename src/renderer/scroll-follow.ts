/*
 * Adapted from Caho1/open-claude-ui, code-examples/useClaudeScrollPinning.ts, MIT,
 * commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * Pure scroll-follow decisions, kept out of the view so the thresholds and the
 * gesture cooldown can be exercised without a DOM.
 */

/** Distance from the bottom that still counts as pinned to the live edge. */
export const PINNED_TOLERANCE = 40;
/** Past this distance the jump control replaces the live edge. */
export const JUMP_DISTANCE = 120;
/** A wheel, touch or key gesture owns the viewport for this long. */
export const GESTURE_COOLDOWN_MS = 150;

export function distanceFromBottom(element: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

export function isPinned(distance: number): boolean {
  return distance <= PINNED_TOLERANCE;
}

export function showsJump(distance: number): boolean {
  return distance > JUMP_DISTANCE;
}

/**
 * Streaming text may only re-anchor when the reader has not just scrolled.
 * A skipped follow is picked up by the next streamed append or the next turn.
 */
export function shouldFollow(pinned: boolean, lastGestureAt: number, now: number): boolean {
  return pinned && now - lastGestureAt >= GESTURE_COOLDOWN_MS;
}
