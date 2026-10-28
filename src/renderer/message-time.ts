/**
 * Timestamp presentation for message meta rows. Values come from the real
 * transcript; a missing or invalid timestamp renders nothing rather than a
 * placeholder such as "just now".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function valid(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp > 0;
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string | null {
  if (!valid(timestamp)) return null;
  const delta = now - timestamp;
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (delta < MINUTE) return 'Just now';
  if (delta < HOUR) return formatter.format(-Math.round(delta / MINUTE), 'minute');
  if (delta < DAY) return formatter.format(-Math.round(delta / HOUR), 'hour');
  if (delta < WEEK) return formatter.format(-Math.round(delta / DAY), 'day');
  if (delta < MONTH) return formatter.format(-Math.round(delta / WEEK), 'week');
  if (delta < YEAR) return formatter.format(-Math.round(delta / MONTH), 'month');
  return formatter.format(-Math.round(delta / YEAR), 'year');
}

export function formatAbsoluteTime(timestamp: number): string | null {
  if (!valid(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

/** Machine-readable value for <time dateTime>; out-of-range numbers stay empty. */
export function formatIsoTime(timestamp: number): string | null {
  if (!valid(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
