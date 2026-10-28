import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { normalizePreferences } from '../../src/main/preferences-schema';

let temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
  vi.doUnmock('electron');
});

async function preferenceHandlers() {
  vi.resetModules();
  const root = await mkdtemp(join(tmpdir(), 'aster-prefs-'));
  temporaryRoots.push(root);
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
  vi.doMock('electron', () => ({
    app: { getPath: () => root },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  }));
  const { registerPreferences } = await import('../../src/main/preferences');
  const webContents = {};
  registerPreferences({ webContents } as never, 'http://aster.test');
  const event = { sender: webContents, senderFrame: { url: 'http://aster.test/' } };
  return { root, read: handlers.get('aster:prefs-read')!, write: handlers.get('aster:prefs-write')!, event };
}

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

describe('preferences persistence', () => {
  test('only a missing preferences file reads as empty and concurrent writes preserve both patches', async () => {
    const { read, write, event, root } = await preferenceHandlers();
    expect(await read(event)).toEqual({ ok: true, prefs: {} });
    const results = await Promise.all([
      write(event, { sidebarWidth: 300 }),
      write(event, { mode: 'code' }),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(JSON.parse(await readFile(join(root, 'ui-preferences.json'), 'utf8')))
      .toEqual({ sidebarWidth: 300, mode: 'code' });
  });

  test('corrupt file errors are visible and a write leaves the original bytes untouched', async () => {
    const { read, write, event, root } = await preferenceHandlers();
    const path = join(root, 'ui-preferences.json');
    const original = '{"sidebarWidth":';
    await writeFile(path, original, 'utf8');
    expect(await read(event)).toEqual({ ok: false, error: 'Saved interface preferences could not be read.' });
    expect(await write(event, { mode: 'code' })).toEqual({
      ok: false,
      error: 'Interface preferences could not be saved. Check that the preferences file is readable and writable.',
    });
    expect(await readFile(path, 'utf8')).toBe(original);
  });
});
