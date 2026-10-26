import { contextBridge, ipcRenderer } from 'electron';

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
};

contextBridge.exposeInMainWorld('asterNative', bridge);
