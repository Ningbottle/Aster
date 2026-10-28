import { describe, expect, it } from 'vitest';
import { clampSidebarWidth, readStoredSidebarWidth, sidebarWidthForKey, sidebarWidthLimit } from '../../src/renderer/sidebar-width';

describe('sidebar width', () => {
  it('keeps the navigation inside its own bounds', () => {
    expect(clampSidebarWidth(100, 1600)).toBe(240);
    expect(clampSidebarWidth(900, 1600)).toBe(420);
    expect(clampSidebarWidth(312.4, 1600)).toBe(312);
  });

  it('never takes width the conversation needs in a narrow window', () => {
    expect(sidebarWidthLimit(900)).toEqual({ min: 240, max: 260 });
    expect(clampSidebarWidth(400, 900)).toBe(260);
    /** An unusably narrow window keeps the minimum rather than collapsing to zero. */
    expect(clampSidebarWidth(400, 600).valueOf()).toBe(240);
  });

  it('steps with the keyboard and resets to the default width', () => {
    expect(sidebarWidthForKey('ArrowRight', 288, 1600, false)).toBe(296);
    expect(sidebarWidthForKey('ArrowLeft', 288, 1600, true)).toBe(256);
    expect(sidebarWidthForKey('Home', 320, 1600, false)).toBe(240);
    expect(sidebarWidthForKey('End', 320, 1600, false)).toBe(420);
    expect(sidebarWidthForKey('Enter', 300, 1600, false)).toBe(288);
    expect(sidebarWidthForKey('a', 300, 1600, false)).toBeNull();
  });

  it('ignores stored values that are not a usable width', () => {
    expect(readStoredSidebarWidth(null)).toBeNull();
    expect(readStoredSidebarWidth('abc')).toBeNull();
    expect(readStoredSidebarWidth('120')).toBeNull();
    expect(readStoredSidebarWidth('9999')).toBeNull();
    expect(readStoredSidebarWidth('301')).toBe(301);
  });
});
