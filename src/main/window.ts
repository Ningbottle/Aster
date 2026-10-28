import { BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { registerNativeActions } from './native';
import { registerPreferences } from './preferences';

export async function createWindow(origin: string): Promise<BrowserWindow> {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('The desktop host must use loopback HTTP.');
  const isolated = session.fromPartition('aster');
  // Copy buttons need to write text; clipboard reads and every other permission stay denied.
  const clipboardWrite = (permission: string) => permission === 'clipboard-sanitized-write';
  isolated.setPermissionRequestHandler((_contents, permission, callback) => callback(clipboardWrite(permission)));
  isolated.setPermissionCheckHandler((_contents, permission) => clipboardWrite(permission));
  isolated.on('will-download', event => event.preventDefault());
  const window = new BrowserWindow({
    width: 1400, height: 840, minWidth: 800, minHeight: 600, show: false, title: 'Aster',
    backgroundColor: '#fcfcfb',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#fcfcfb', symbolColor: '#3d3d3a', height: 32 },
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, session: isolated, preload: join(__dirname, '../preload/index.cjs') },
  });
  window.removeMenu();
  const disposeNative = registerNativeActions(window, endpoint.origin);
  const disposePreferences = registerPreferences(window, endpoint.origin);
  window.on('closed', () => { disposeNative(); disposePreferences(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  // Main frame navigation stays blocked; preview frames are sandboxed and CSP frame-src caps them.
  window.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame) event.preventDefault();
  });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  await window.loadURL(endpoint.origin);
  window.show();
  return window;
}
