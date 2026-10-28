import { describe, expect, test } from 'vitest';
import { applyPreferences, loadedPreferences, onPreferenceError, persistPreference, seedPreferences } from '../../src/renderer/ui-preferences';

function fakeStorage(): Storage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get length() { return entries.size; },
    clear: () => { entries.clear(); },
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => { entries.delete(key); },
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}

describe('stored interface preferences', () => {
  test('the saved preferences land in the keys the renderer already reads', () => {
    const store = fakeStorage();
    applyPreferences(store, { sidebarWidth: 296, selection: { workspaceId: 'w1', sessionId: 's1' } });
    expect(store.entries.get('aster.sidebar-width')).toBe('296');
    expect(JSON.parse(store.entries.get('aster.selection') ?? '')).toEqual({ workspaceId: 'w1', sessionId: 's1' });
  });

  test('an empty profile writes nothing, so defaults still apply', () => {
    const store = fakeStorage();
    applyPreferences(store, {});
    expect(store.length).toBe(0);
    applyPreferences(store, { sidebarWidth: 320 });
    expect([...store.entries.keys()]).toEqual(['aster.sidebar-width']);
  });

  test('a window-level change is remembered for the next read', () => {
    persistPreference({ mode: 'chat', sidebarOpen: false });
    expect(loadedPreferences()).toMatchObject({ mode: 'chat', sidebarOpen: false });
    persistPreference({ sidebarOpen: true });
    expect(loadedPreferences()).toMatchObject({ mode: 'chat', sidebarOpen: true });
  });

  test('read errors are replayed to late subscribers and failed reads keep empty preferences', async () => {
    const previous = (globalThis as { window?: Window }).window;
    let readFails = true;
    const native = {
      openFile: async () => ({ ok: true }), openFolder: async () => ({ ok: true }), openExternal: async () => ({ ok: true }),
      readPreferences: async () => readFails
        ? { ok: false as const, error: 'Saved preferences are unreadable.' }
        : { ok: true as const, prefs: {} },
      writePreferences: async () => ({ ok: true as const }),
    };
    (globalThis as { window?: Window }).window = { asterNative: native } as unknown as Window;
    try {
      await seedPreferences();
      expect(loadedPreferences()).toEqual({});
      const errors: string[] = [];
      const changes: Array<string | undefined> = [];
      const unsubscribe = onPreferenceError(message => {
        changes.push(message);
        if (message) errors.push(message);
      });
      expect(errors).toEqual(['Saved interface preferences could not be read.']);
      readFails = false;
      await seedPreferences();
      expect(loadedPreferences()).toEqual({});
      expect(changes).toEqual(['Saved interface preferences could not be read.', undefined]);
      const lateErrors: string[] = [];
      const unsubscribeLate = onPreferenceError(message => { if (message) lateErrors.push(message); });
      expect(lateErrors).toEqual([]);
      unsubscribeLate();
      unsubscribe();
    } finally {
      if (previous) (globalThis as { window?: Window }).window = previous;
      else delete (globalThis as { window?: Window }).window;
    }
  });

  test('a failed localStorage mirror reports a generic error and keeps successfully read preferences', async () => {
    const previousWindow = (globalThis as { window?: Window }).window;
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const native = {
      openFile: async () => ({ ok: true }), openFolder: async () => ({ ok: true }), openExternal: async () => ({ ok: true }),
      readPreferences: async () => ({
        ok: true as const,
        prefs: { selection: { workspaceId: 'w-kept', sessionId: 's-kept' } },
      }),
      writePreferences: async () => ({ ok: true as const }),
    };
    (globalThis as { window?: Window }).window = { asterNative: native } as unknown as Window;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { setItem: () => { throw new Error('storage failure with private path'); } },
    });
    try {
      await seedPreferences();
      expect(loadedPreferences()).toEqual({ selection: { workspaceId: 'w-kept', sessionId: 's-kept' } });
      const errors: string[] = [];
      const unsubscribe = onPreferenceError(message => { if (message) errors.push(message); });
      expect(errors).toEqual(['Saved interface preferences were loaded but could not be restored in this window.']);
      expect(errors.join(' ')).not.toContain('private path');
      unsubscribe();
    } finally {
      if (previousWindow) (globalThis as { window?: Window }).window = previousWindow;
      else delete (globalThis as { window?: Window }).window;
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  test('every preference write is dispatched without a renderer queue', () => {
    const previous = (globalThis as { window?: Window }).window;
    const writes: unknown[] = [];
    const native = {
      openFile: async () => ({ ok: true }), openFolder: async () => ({ ok: true }), openExternal: async () => ({ ok: true }),
      readPreferences: async () => ({ ok: true as const, prefs: {} }),
      writePreferences: (patch: unknown) => { writes.push(patch); return Promise.resolve({ ok: true as const }); },
    };
    (globalThis as { window?: Window }).window = { asterNative: native } as unknown as Window;
    try {
      persistPreference({ mode: 'chat' });
      persistPreference({ sidebarOpen: false });
      expect(writes).toEqual([{ mode: 'chat' }, { sidebarOpen: false }]);
    } finally {
      if (previous) (globalThis as { window?: Window }).window = previous;
      else delete (globalThis as { window?: Window }).window;
    }
  });

  test('a successful save clears the error and new subscribers do not replay it', async () => {
    const previous = (globalThis as { window?: Window }).window;
    let saveFails = true;
    const native = {
      openFile: async () => ({ ok: true }), openFolder: async () => ({ ok: true }), openExternal: async () => ({ ok: true }),
      readPreferences: async () => ({ ok: true as const, prefs: {} }),
      writePreferences: async () => saveFails
        ? { ok: false as const, error: 'Preferences could not be saved.' }
        : { ok: true as const },
    };
    (globalThis as { window?: Window }).window = { asterNative: native } as unknown as Window;
    try {
      persistPreference({ mode: 'code' });
      await Promise.resolve();
      await Promise.resolve();
      const changes: Array<string | undefined> = [];
      const unsubscribe = onPreferenceError(message => changes.push(message));
      expect(changes).toEqual(['Preferences could not be saved.']);
      saveFails = false;
      persistPreference({ mode: 'chat' });
      await Promise.resolve();
      await Promise.resolve();
      expect(changes).toEqual(['Preferences could not be saved.', undefined]);
      const lateChanges: Array<string | undefined> = [];
      const unsubscribeLate = onPreferenceError(message => lateChanges.push(message));
      expect(lateChanges).toEqual([]);
      unsubscribeLate();
      unsubscribe();
    } finally {
      if (previous) (globalThis as { window?: Window }).window = previous;
      else delete (globalThis as { window?: Window }).window;
    }
  });
});
