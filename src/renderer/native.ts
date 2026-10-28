import type { PreferencesReadResult, PreferencesWriteResult, UiPreferences } from '@thinkrail/contracts';
export type { UiPreferences } from '@thinkrail/contracts';

export interface NativeResult {
  ok: boolean;
  error?: string;
}
interface NativeBridge {
  openFile(workspaceId: string, path: string): Promise<NativeResult>;
  openFolder(workspaceId: string): Promise<NativeResult>;
  openExternal(url: string): Promise<NativeResult>;
  readPreferences(): Promise<PreferencesReadResult>;
  writePreferences(patch: UiPreferences): Promise<PreferencesWriteResult>;
}

declare global {
  interface Window {
    asterNative?: NativeBridge;
  }
}

const unavailable = (): NativeResult => ({ ok: false, error: 'File actions are unavailable outside the desktop app.' });

export async function openFileInWorkspace(workspaceId: string, path: string): Promise<NativeResult> {
  if (!window.asterNative) return unavailable();
  return window.asterNative.openFile(workspaceId, path);
}

export async function openFolder(workspaceId: string): Promise<NativeResult> {
  if (!window.asterNative) return unavailable();
  return window.asterNative.openFolder(workspaceId);
}

export async function openExternal(url: string): Promise<NativeResult> {
  if (!window.asterNative) return unavailable();
  return window.asterNative.openExternal(url);
}

/** Preferences live in the Electron profile; the browser build simply has none. */
export async function readPreferences(): Promise<UiPreferences> {
  if (typeof window === 'undefined' || !window.asterNative) return {};
  const result = await window.asterNative.readPreferences();
  if (!result.ok) throw new Error(result.error);
  return result.prefs;
}

export async function writePreferences(patch: UiPreferences): Promise<PreferencesWriteResult> {
  if (typeof window === 'undefined' || !window.asterNative) {
    return { ok: false, error: 'Preferences are unavailable outside the desktop app.' };
  }
  try {
    return await window.asterNative.writePreferences(patch);
  } catch {
    return { ok: false, error: 'Interface preferences could not be saved.' };
  }
}
