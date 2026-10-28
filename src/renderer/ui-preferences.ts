import { readPreferences, writePreferences, type UiPreferences } from './native';

const SELECTION_KEY = 'aster.selection';
const SIDEBAR_WIDTH_KEY = 'aster.sidebar-width';

/** Mirror of what main holds on disk; `mode` and `sidebarOpen` are read from here, not from storage. */
let loaded: UiPreferences = {};

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
  const prefs = await readPreferences();
  loaded = { ...prefs };
  if (prefs.sidebarWidth === undefined && !prefs.selection) return;
  try {
    applyPreferences(localStorage, prefs);
  } catch (error) {
    console.warn('The stored interface preferences could not be restored.', error);
  }
}

let queue: Promise<void> = Promise.resolve();

/** Serialized so two quick changes cannot interleave their read-modify-write in main. */
export function persistPreference(patch: UiPreferences): void {
  loaded = { ...loaded, ...patch };
  if (typeof window === 'undefined' || !window.asterNative) return;
  queue = queue
    .then(async () => {
      const result = await writePreferences(patch);
      if (!result.ok) console.warn('The interface preference could not be saved.', result.error);
    })
    .catch(error => { console.warn('The interface preference could not be saved.', error); });
}
