export interface NativeResult {
  ok: boolean;
  error?: string;
}

export interface UiPreferences {
  sidebarWidth?: number;
  selection?: { workspaceId: string; sessionId: string } | null;
  mode?: 'chat' | 'code';
  sidebarOpen?: boolean;
  previewRatio?: number;
}

interface PreferencesReadResult {
  ok: boolean;
  prefs?: UiPreferences;
  error?: string;
}

interface NativeBridge {
  openFile(workspaceId: string, path: string): Promise<NativeResult>;
  openFolder(workspaceId: string): Promise<NativeResult>;
  openExternal(url: string): Promise<NativeResult>;
  readPreferences(): Promise<PreferencesReadResult>;
  writePreferences(patch: UiPreferences): Promise<NativeResult>;
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
  try {
    const result = await window.asterNative.readPreferences();
    return result.ok && result.prefs ? result.prefs : {};
  } catch {
    return {};
  }
}

export async function writePreferences(patch: UiPreferences): Promise<NativeResult> {
  if (typeof window === 'undefined' || !window.asterNative) {
    return { ok: false, error: 'Preferences are unavailable outside the desktop app.' };
  }
  try {
    return await window.asterNative.writePreferences(patch);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
