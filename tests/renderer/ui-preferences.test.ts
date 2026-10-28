import { describe, expect, test } from 'vitest';
import { applyPreferences, loadedPreferences, persistPreference } from '../../src/renderer/ui-preferences';

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
});
