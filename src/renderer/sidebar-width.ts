/**
 * Left navigation width is a user preference, independent from the fixed
 * information rail and from the resizable file preview. The window can shrink
 * below the preferred width; the rendered width is clamped per viewport while
 * the stored preference keeps its original value.
 */
import { persistPreference } from './ui-preferences';

export const SIDEBAR_DEFAULT_WIDTH = 288;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 420;
/** The conversation must still keep a usable column next to the navigation. */
export const WORKSPACE_MIN_WIDTH = 640;
export const SIDEBAR_KEYBOARD_STEP = 8;
export const SIDEBAR_KEYBOARD_STEP_COARSE = 32;
export const SIDEBAR_WIDTH_STORAGE_KEY = 'aster.sidebar-width';

export function sidebarWidthLimit(viewportWidth: number): { min: number; max: number } {
  const max = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(viewportWidth - WORKSPACE_MIN_WIDTH)));
  return { min: SIDEBAR_MIN_WIDTH, max };
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const { min, max } = sidebarWidthLimit(viewportWidth);
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Arrow/Home/End handling for the separator; null means the key is not ours. */
export function sidebarWidthForKey(key: string, width: number, viewportWidth: number, shiftKey: boolean): number | null {
  const { min, max } = sidebarWidthLimit(viewportWidth);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  if (key === 'Enter') return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewportWidth);
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const step = shiftKey ? SIDEBAR_KEYBOARD_STEP_COARSE : SIDEBAR_KEYBOARD_STEP;
  return clampSidebarWidth(width + (key === 'ArrowLeft' ? -step : step), viewportWidth);
}

/** Stored values are user input from another session; reject anything unusable. */
export function readStoredSidebarWidth(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= SIDEBAR_MIN_WIDTH && value <= SIDEBAR_MAX_WIDTH ? Math.round(value) : null;
}

/** The stored preference, clamped to the current window. */
export function preferredSidebarWidth(viewportWidth: number): number {
  let stored: string | null = null;
  try {
    stored = typeof window === 'undefined' ? null : window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  } catch (error) {
    console.warn('The sidebar width preference could not be read.', error);
  }
  return clampSidebarWidth(readStoredSidebarWidth(stored) ?? SIDEBAR_DEFAULT_WIDTH, viewportWidth);
}

export function rememberSidebarWidth(width: number): void {
  const rounded = Math.round(width);
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(rounded));
  } catch (error) {
    console.warn('The sidebar width preference could not be saved.', error);
  }
  // The renderer's localStorage dies with the origin; the desktop build also stores it in the profile.
  persistPreference({ sidebarWidth: rounded });
}
