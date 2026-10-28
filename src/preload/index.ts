import { contextBridge, ipcRenderer } from 'electron';

export interface NativeResult {
  ok: boolean;
  error?: string;
}

export interface UiPreferences {
  sidebarWidth?: number;
  selection?: { workspaceId: string; sessionId: string } | null;
}

export interface PreferencesReadResult {
  ok: boolean;
  prefs?: UiPreferences;
  error?: string;
}

const bridge = {
  openFile: (workspaceId: string, path: string): Promise<NativeResult> =>
    ipcRenderer.invoke('aster:native-open-file', { workspaceId, path }) as Promise<NativeResult>,
  openFolder: (workspaceId: string): Promise<NativeResult> =>
    ipcRenderer.invoke('aster:native-open-folder', { workspaceId }) as Promise<NativeResult>,
  openExternal: (url: string): Promise<NativeResult> =>
    ipcRenderer.invoke('aster:native-open-external', { url }) as Promise<NativeResult>,
  readPreferences: (): Promise<PreferencesReadResult> =>
    ipcRenderer.invoke('aster:prefs-read') as Promise<PreferencesReadResult>,
  writePreferences: (patch: UiPreferences): Promise<NativeResult> =>
    ipcRenderer.invoke('aster:prefs-write', patch) as Promise<NativeResult>,
};

contextBridge.exposeInMainWorld('asterNative', bridge);
