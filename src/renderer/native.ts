export interface NativeResult {
  ok: boolean;
  error?: string;
}

interface NativeBridge {
  openFile(workspaceId: string, path: string): Promise<NativeResult>;
  openFolder(workspaceId: string): Promise<NativeResult>;
  openExternal(url: string): Promise<NativeResult>;
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
