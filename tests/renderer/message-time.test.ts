import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, formatRelativeTime } from '../../src/renderer/message-time';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('message timestamps', () => {
  it('formats real transcript timestamps relatively', () => {
    expect(formatRelativeTime(NOW - 4 * DAY, NOW)).toBe('4 days ago');
    expect(formatRelativeTime(NOW - 5 * 60 * 1000, NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe('Just now');
  });

  it('renders nothing for missing or invalid timestamps', () => {
    expect(formatRelativeTime(0, NOW)).toBeNull();
    expect(formatRelativeTime(Number.NaN, NOW)).toBeNull();
    expect(formatAbsoluteTime(0)).toBeNull();
    expect(formatAbsoluteTime(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps the absolute time available for the tooltip', () => {
    expect(formatAbsoluteTime(Date.UTC(2026, 9, 23, 8, 30))).toContain('2026');
  });
});
