import { app, ipcMain, type BrowserWindow } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { senderIsWindow } from './ipc-guard';
import { normalizePreferences, type UiPreferences } from './preferences-schema';

/**
 * Window and navigation preferences. They live next to the Electron profile
 * because the renderer cannot persist them itself: every launch serves the app
 * from a new 127.0.0.1 port, so `localStorage` sees a different origin each run.
 */
const FILE_NAME = 'ui-preferences.json';
const READ = 'aster:prefs-read';
const WRITE = 'aster:prefs-write';

function preferencesPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

/** A corrupt or half-written file is treated as "no preferences", never as a crash. */
async function readPreferences(): Promise<UiPreferences> {
  try {
    return normalizePreferences(JSON.parse(await readFile(preferencesPath(), 'utf8')));
  } catch {
    return {};
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
    return { ok: true, prefs: await readPreferences() };
  });

  ipcMain.handle(WRITE, async (event, payload: unknown) => {
    guard(event);
    try {
      const patch = normalizePreferences(payload);
      const current = await readPreferences();
      const next: UiPreferences = { ...current, ...patch };
      if (patch.selection === null) delete next.selection;
      await writePreferences(next);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return () => {
    ipcMain.removeHandler(READ);
    ipcMain.removeHandler(WRITE);
  };
}
