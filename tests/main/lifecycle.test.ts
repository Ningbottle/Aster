import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

async function launcher(forceFails = false) {
  vi.resetModules();
  vi.useFakeTimers();
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(), whenReady: () => Promise.resolve(), exited: false,
    quit(this: EventEmitter & { exited: boolean }) {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('before-quit', event);
      if (!event.prevented) this.exited = true;
    },
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 3210, exitCode: null as number | null, signalCode: null as string | null,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(),
  });
  const close = () => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0); };
  const execFile = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    if (forceFails) callback(new Error('Tree stop failed.'), '', '');
    else { close(); callback(null, '', ''); }
  });
  const showErrorBox = vi.fn();
  const createWindow = vi.fn().mockResolvedValue(undefined);
  vi.doMock('electron', () => ({ app, dialog: { showErrorBox } }));
  vi.doMock('node:child_process', () => ({ spawn: () => child, execFile }));
  vi.doMock('../../src/main/window', () => ({ createWindow }));
  await import('../../src/main/index');
  await vi.advanceTimersByTimeAsync(0);
  return { app, child, close, execFile, showErrorBox, createWindow };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.doUnmock('electron');
  vi.doUnmock('node:child_process');
  vi.doUnmock('../../src/main/window');
});

describe('desktop host lifetime', () => {
  it('bounds shutdown when the host never reaches readiness', async () => {
    const current = await launcher();
    await vi.advanceTimersByTimeAsync(95_000);
    expect(current.createWindow).not.toHaveBeenCalled();
    expect(current.execFile).toHaveBeenCalledWith(expect.stringContaining('taskkill.exe'), ['/PID', '3210', '/T', '/F'], expect.objectContaining({ timeout: 5_000 }), expect.any(Function));
    expect(current.app.exited).toBe(true);
    expect(current.showErrorBox).toHaveBeenCalledWith('Aster startup failed', expect.stringContaining('90 seconds'));
  });

  it('does not force a host that acknowledges ordinary shutdown', async () => {
    const current = await launcher();
    current.child.stdout.write('ASTER_HOST_READY {"port":12345}\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(current.createWindow).toHaveBeenCalledWith('http://127.0.0.1:12345');
    current.app.quit();
    current.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(current.app.exited).toBe(true);
    expect(current.execFile).not.toHaveBeenCalled();
  });

  it('reports failed forced shutdown instead of waiting forever', async () => {
    const current = await launcher(true);
    await vi.advanceTimersByTimeAsync(95_000);
    expect(current.app.exited).toBe(true);
    expect(current.showErrorBox).toHaveBeenCalledWith('Aster shutdown failed', 'Tree stop failed.');
    current.close();
  });
});
