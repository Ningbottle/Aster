import { readPreferences, writePreferences, type UiPreferences } from './native';

const SELECTION_KEY = 'aster.selection';
const SIDEBAR_WIDTH_KEY = 'aster.sidebar-width';

/** Mirror of what main holds on disk; `mode` and `sidebarOpen` are read from here, not from storage. */
let loaded: UiPreferences = {};
let preferenceError: string | undefined;
const preferenceErrorHandlers = new Set<(message: string | undefined) => void>();

function reportPreferenceError(message: string | undefined): void {
  preferenceError = message;
  for (const handler of preferenceErrorHandlers) handler(message);
}

export function onPreferenceError(handler: (message: string | undefined) => void): () => void {
  preferenceErrorHandlers.add(handler);
  if (preferenceError) handler(preferenceError);
  return () => preferenceErrorHandlers.delete(handler);
}

/** Filled before the first render, so the shell starts already restored. */
export function loadedPreferences(): UiPreferences {
  return { ...loaded };
}

/**
 * Every reader still looks at `localStorage`, so the stored preferences are
 * copied into it before the first render. The renderer's own storage cannot
 * survive a restart: each launch serves the app from a new 127.0.0.1 port, so
 * the origin — and with it the whole storage bucket — changes every time.
 */
export function applyPreferences(store: Storage, prefs: UiPreferences): void {
  if (typeof prefs.sidebarWidth === 'number') store.setItem(SIDEBAR_WIDTH_KEY, String(prefs.sidebarWidth));
  if (prefs.selection) store.setItem(SELECTION_KEY, JSON.stringify(prefs.selection));
}

export async function seedPreferences(): Promise<void> {
  let prefs: UiPreferences;
  try {
    prefs = await readPreferences();
  } catch {
    loaded = {};
    reportPreferenceError('Saved interface preferences could not be read.');
    return;
  }

  loaded = { ...prefs };
  reportPreferenceError(undefined);
  if (prefs.sidebarWidth === undefined && !prefs.selection) return;
  try {
    applyPreferences(localStorage, prefs);
  } catch {
    reportPreferenceError('Saved interface preferences were loaded but could not be restored in this window.');
  }
}

/** Each update is sent immediately; main serializes disk read-modify-write operations. */
export function persistPreference(patch: UiPreferences): void {
  loaded = { ...loaded, ...patch };
  void writePreferences(patch).then(result => {
    if (result.ok) reportPreferenceError(undefined);
    else reportPreferenceError(result.error ?? 'Interface preferences could not be saved.');
  });
}
