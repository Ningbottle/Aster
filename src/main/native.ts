import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { stat } from 'node:fs/promises';
import { resolveFileInRoot } from './native-paths';
import { createWorkspaceRootResolver } from './workspace-roots';

export interface NativeResult {
  ok: boolean;
  error?: string;
}

const FILE = 'aster:native-open-file';
const FOLDER = 'aster:native-open-folder';
const EXTERNAL = 'aster:native-open-external';

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error(`Invalid ${name}.`);
  return value;
}

function senderIsWindow(window: BrowserWindow, origin: string) {
  return (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents) throw new Error('Unexpected IPC sender.');
    const url = event.senderFrame?.url ?? '';
    if (!url.startsWith(`${origin}/`) && url !== origin) throw new Error('Unexpected IPC frame.');
  };
}

async function openWithShell(path: string): Promise<NativeResult> {
  const error = await shell.openPath(path);
  return error ? { ok: false, error } : { ok: true };
}

export function registerNativeActions(window: BrowserWindow, origin: string): () => void {
  const guard = senderIsWindow(window, origin);
  const roots = createWorkspaceRootResolver(origin);

  ipcMain.handle(FILE, async (event, payload: unknown): Promise<NativeResult> => {
    guard(event);
    try {
      const record = payload as { workspaceId?: unknown; path?: unknown } | null;
      const workspaceId = stringField(record?.workspaceId, 'workspace id');
      const requested = stringField(record?.path, 'file path');
      const root = await roots.resolve(workspaceId);
      const target = await resolveFileInRoot(root, requested);
      const info = await stat(target);
      if (!info.isFile()) return { ok: false, error: 'The path is not a file.' };
      return await openWithShell(target);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(FOLDER, async (event, payload: unknown): Promise<NativeResult> => {
    guard(event);
    try {
      const workspaceId = stringField((payload as { workspaceId?: unknown } | null)?.workspaceId, 'workspace id');
      const target = await roots.resolve(workspaceId);
      const info = await stat(target);
      if (!info.isDirectory()) return { ok: false, error: 'The path is not a folder.' };
      return await openWithShell(target);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(EXTERNAL, async (event, payload: unknown): Promise<NativeResult> => {
    guard(event);
    try {
      const raw = stringField((payload as { url?: unknown } | null)?.url, 'URL');
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, error: 'Only http(s) links can be opened.' };
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return () => {
    roots.dispose();
    ipcMain.removeHandler(FILE);
    ipcMain.removeHandler(FOLDER);
    ipcMain.removeHandler(EXTERNAL);
  };
}
