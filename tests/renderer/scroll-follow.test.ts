import { describe, expect, it } from 'vitest';
import { GESTURE_COOLDOWN_MS, JUMP_DISTANCE, PINNED_TOLERANCE, distanceFromBottom, isPinned, shouldFollow, showsJump } from '../../src/renderer/scroll-follow';

describe('scroll follow decisions', () => {
  it('measures the distance left below the last line', () => {
    expect(distanceFromBottom({ scrollHeight: 1200, scrollTop: 600, clientHeight: 500 })).toBe(100);
    expect(distanceFromBottom({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 })).toBe(0);
  });

  it('pins within the 40px tolerance only', () => {
    expect(isPinned(PINNED_TOLERANCE)).toBe(true);
    expect(isPinned(PINNED_TOLERANCE + 1)).toBe(false);
    expect(isPinned(0)).toBe(true);
  });

  it('offers the jump control past 120px', () => {
    expect(showsJump(JUMP_DISTANCE)).toBe(false);
    expect(showsJump(JUMP_DISTANCE + 1)).toBe(true);
  });

  it('lets a fresh gesture own the viewport for the cooldown window', () => {
    expect(shouldFollow(true, 1000, 1000 + GESTURE_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldFollow(true, 1000, 1000 + GESTURE_COOLDOWN_MS)).toBe(true);
    expect(shouldFollow(true, 0, 5000)).toBe(true);
  });

  it('never follows once the reader left the live edge', () => {
    expect(shouldFollow(false, 0, 5000)).toBe(false);
  });
});
