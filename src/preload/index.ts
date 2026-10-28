import { contextBridge, ipcRenderer } from 'electron';
import type { PreferencesReadResult, PreferencesWriteResult, UiPreferences } from '@thinkrail/contracts';

export interface NativeResult {
  ok: boolean;
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
  writePreferences: (patch: UiPreferences): Promise<PreferencesWriteResult> =>
    ipcRenderer.invoke('aster:prefs-write', patch) as Promise<PreferencesWriteResult>,
};

contextBridge.exposeInMainWorld('asterNative', bridge);
