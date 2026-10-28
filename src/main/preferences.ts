import { app, ipcMain, type BrowserWindow } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PreferencesReadResult, PreferencesWriteResult, UiPreferences } from '@thinkrail/contracts';
import { senderIsWindow } from './ipc-guard';
import { normalizePreferences } from './preferences-schema';

/**
 * Window and navigation preferences. They live next to the Electron profile
 * because the renderer cannot persist them itself: every launch serves the app
 * from a new 127.0.0.1 port, so `localStorage` sees a different origin each run.
 */
const FILE_NAME = 'ui-preferences.json';
const READ = 'aster:prefs-read';
const WRITE = 'aster:prefs-write';
const READ_ERROR = 'Saved interface preferences could not be read.';
const WRITE_ERROR = 'Interface preferences could not be saved. Check that the preferences file is readable and writable.';

let pendingWrites: Promise<void> = Promise.resolve();

function preferencesPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function readPreferences(): Promise<UiPreferences> {
  try {
    return normalizePreferences(JSON.parse(await readFile(preferencesPath(), 'utf8')));
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
}

async function writePreferences(next: UiPreferences): Promise<void> {
  const path = preferencesPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
  await rename(temporary, path);
}

export function registerPreferences(window: BrowserWindow, origin: string): () => void {
  const guard = senderIsWindow(window, origin);

  ipcMain.handle(READ, async (event) => {
    guard(event);
    try {
      const result: PreferencesReadResult = { ok: true, prefs: await readPreferences() };
      return result;
    } catch {
      const result: PreferencesReadResult = { ok: false, error: READ_ERROR };
      return result;
    }
  });

  ipcMain.handle(WRITE, async (event, payload: unknown) => {
    guard(event);
    try {
      const patch = normalizePreferences(payload);
      const write = pendingWrites.then(async (): Promise<PreferencesWriteResult> => {
        try {
          const current = await readPreferences();
          const next: UiPreferences = { ...current, ...patch };
          if (patch.selection === null) delete next.selection;
          await writePreferences(next);
          return { ok: true };
        } catch {
          return { ok: false, error: WRITE_ERROR };
        }
      });
      pendingWrites = write.then(() => undefined, () => undefined);
      return await write;
    } catch {
      return { ok: false, error: 'Invalid interface preference update.' };
    }
  });

  return () => {
    ipcMain.removeHandler(READ);
    ipcMain.removeHandler(WRITE);
  };
}

export function waitForPreferenceWrites(): Promise<void> {
  return pendingWrites;
}
