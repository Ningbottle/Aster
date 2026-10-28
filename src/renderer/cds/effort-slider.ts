import type { ThinkingLevel } from '@thinkrail/contracts';

/** Product order for thinking effort, lowest first. */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortSliderKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/**
 * The track shows every level this model reports, in product order. A level the
 * model no longer supports stays visible only while it is the current value, so
 * the reading never jumps to a different level behind the user's back.
 */
export function effortTrack(levels: readonly ThinkingLevel[], value: ThinkingLevel): ThinkingLevel[] {
  const track = EFFORT_LEVELS.filter(level => levels.includes(level));
  if (track.length === 0) return levels.includes(value) ? [value] : [];
  if (!track.includes(value)) track.push(value);
  return track;
}

export function effortAtPosition(track: readonly ThinkingLevel[], fraction: number): ThinkingLevel | null {
  if (track.length === 0 || !Number.isFinite(fraction)) return null;
  const index = Math.round(Math.max(0, Math.min(1, fraction)) * (track.length - 1));
  return track[index] ?? null;
}

/** Keyboard stepping stays inside the levels this model actually reports. */
export function nextSupportedEffort(
  track: readonly ThinkingLevel[], levels: readonly ThinkingLevel[], current: ThinkingLevel, key: EffortSliderKey,
): ThinkingLevel | null {
  const available = track.filter(level => levels.includes(level));
  if (available.length === 0) return null;
  if (key === 'Home') return available[0];
  if (key === 'End') return available[available.length - 1];
  const direction = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : -1;
  const start = available.indexOf(current);
  const nextIndex = start < 0 ? (direction > 0 ? 0 : available.length - 1) : start + direction;
  if (nextIndex < 0 || nextIndex >= available.length) return null;
  return available[nextIndex];
}
