import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

/**
 * Privileged channels accept only the app window's own top frame. A renderer
 * cannot reach these handlers from another frame, a child window or a webview.
 */
export function senderIsWindow(window: BrowserWindow, origin: string) {
  return (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents) throw new Error('Unexpected IPC sender.');
    const url = event.senderFrame?.url ?? '';
    if (!url.startsWith(`${origin}/`) && url !== origin) throw new Error('Unexpected IPC frame.');
  };
}
