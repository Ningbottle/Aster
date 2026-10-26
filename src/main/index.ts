import { app, dialog } from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { createWindow } from './window';

let host: ChildProcessWithoutNullStreams | undefined;
let hostExited = false;
let quitting = false;
let hostExit: Promise<void> | undefined;
app.setName('Aster');

async function waitForHostExit(milliseconds: number): Promise<boolean> {
  if (!hostExit || hostExited) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      hostExit.then(() => true),
      new Promise<false>(resolveTimeout => { timer = setTimeout(() => resolveTimeout(false), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function stopHost(): Promise<void> {
  const child = host;
  if (!child || hostExited) return;
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('shutdown\n');
  if (await waitForHostExit(5_000)) return;
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 });
    } else if (!child.kill('SIGKILL')) {
      throw new Error('The local host did not accept forced shutdown.');
    }
    if (await waitForHostExit(1_000)) {
      dialog.showErrorBox('Aster shutdown timed out', 'The local host was forcibly stopped. Pending work may have been interrupted.');
      return;
    }
  }
  throw new Error('Host shutdown could not be confirmed. A background process may remain.');
}

app.on('before-quit', event => {
  if (quitting || !host || hostExited) return;
  event.preventDefault();
  quitting = true;
  void stopHost().catch(error => {
    dialog.showErrorBox('Aster shutdown failed', error instanceof Error ? error.message : 'Host shutdown could not be confirmed.');
  }).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());

async function startHost(): Promise<string> {
  const root = resolve(__dirname, '../../..');
  const executable = join(root, 'node_modules/bun/bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  host = spawn(executable, [join(root, 'src/host/index.ts')], {
    cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ASTER_DESKTOP_PARENT: '1' },
  });
  host.stdin.on('error', error => {
    if (!quitting && !hostExited) dialog.showErrorBox('Aster host connection', error.message);
  });
  host.stderr.resume();
  hostExit = new Promise(resolveExit => host!.once('close', () => { hostExited = true; resolveExit(); }));
  return new Promise((resolveReady, reject) => {
    let ready = false;
    const lines = createInterface({ input: host!.stdout });
    const timer = setTimeout(() => reject(new Error('The ThinkRail host did not become ready within 90 seconds.')), 90_000);
    host!.once('error', error => { clearTimeout(timer); reject(error); });
    host!.once('exit', code => {
      clearTimeout(timer);
      lines.close();
      if (!ready) reject(new Error(`The ThinkRail host exited during startup (${code}).`));
      else if (!quitting) {
        dialog.showErrorBox('Aster host stopped', `The local host exited (${code}). Restart Aster to reconnect.`);
        app.quit();
      }
    });
    lines.on('line', line => {
      if (ready || !line.startsWith('ASTER_HOST_READY ')) return;
      try {
        const { port } = JSON.parse(line.slice('ASTER_HOST_READY '.length)) as { port: number };
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid host address.');
        ready = true;
        clearTimeout(timer);
        resolveReady(`http://127.0.0.1:${port}`);
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  });
}

void app.whenReady().then(async () => {
  await createWindow(await startHost());
}).catch(error => {
  dialog.showErrorBox('Aster startup failed', error instanceof Error ? error.message : 'Unknown startup error.');
  app.quit();
});
