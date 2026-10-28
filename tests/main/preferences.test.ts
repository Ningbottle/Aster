import { describe, expect, test } from 'vitest';
import { normalizePreferences } from '../../src/main/preferences-schema';

describe('preferences IPC schema', () => {
  test('keeps the known preferences and drops everything else', () => {
    const selection = { workspaceId: 'w1', sessionId: 's1' };
    expect(normalizePreferences({ sidebarWidth: 296, selection, mode: 'chat', sidebarOpen: false, extra: 'ignored', path: 'C:/Windows' }))
      .toEqual({ sidebarWidth: 296, selection, mode: 'chat', sidebarOpen: false });
    expect(normalizePreferences({})).toEqual({});
  });

  test('rejects a width outside the navigation range', () => {
    expect(() => normalizePreferences({ sidebarWidth: 120 })).toThrow(/sidebar width/);
    expect(() => normalizePreferences({ sidebarWidth: 900 })).toThrow(/sidebar width/);
    expect(() => normalizePreferences({ sidebarWidth: 288.5 })).toThrow(/sidebar width/);
    expect(() => normalizePreferences({ sidebarWidth: '288' })).toThrow(/sidebar width/);
  });

  test('a selection needs both ids and null clears it', () => {
    expect(() => normalizePreferences({ selection: { workspaceId: 'w1' } })).toThrow(/session id/);
    expect(() => normalizePreferences({ selection: { workspaceId: '', sessionId: 's1' } })).toThrow(/workspace id/);
    expect(() => normalizePreferences({ selection: { workspaceId: 'w1', sessionId: 'x'.repeat(201) } })).toThrow(/session id/);
    expect(normalizePreferences({ selection: null })).toEqual({ selection: null });
  });

  test('the workspace mode and sidebar state are allowlisted', () => {
    expect(normalizePreferences({ mode: 'code', sidebarOpen: true })).toEqual({ mode: 'code', sidebarOpen: true });
    expect(() => normalizePreferences({ mode: 'Code' })).toThrow(/workspace mode/);
    expect(() => normalizePreferences({ mode: null })).toThrow(/workspace mode/);
    expect(() => normalizePreferences({ sidebarOpen: 'yes' })).toThrow(/sidebar state/);
    expect(() => normalizePreferences({ sidebarOpen: 1 })).toThrow(/sidebar state/);
  });

  test('the preview ratio must be a real share of the row', () => {
    expect(normalizePreferences({ previewRatio: 0.62 })).toEqual({ previewRatio: 0.62 });
    expect(() => normalizePreferences({ previewRatio: 0 })).toThrow(/preview ratio/);
    expect(() => normalizePreferences({ previewRatio: 1 })).toThrow(/preview ratio/);
    expect(() => normalizePreferences({ previewRatio: '0.5' as unknown as number })).toThrow(/preview ratio/);
    expect(() => normalizePreferences({ previewRatio: Number.NaN })).toThrow(/preview ratio/);
  });

  test('rejects payloads that are not an object', () => {
    expect(() => normalizePreferences(null)).toThrow(/preferences payload/);
    expect(() => normalizePreferences('sidebarWidth=1')).toThrow(/preferences payload/);
    expect(() => normalizePreferences([288])).toThrow(/preferences payload/);
  });
});
