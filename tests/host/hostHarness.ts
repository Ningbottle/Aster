import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixtureProvider, fixtureModelsJson } from '../fixtures/fixture-provider.mjs';

export const REPO_ROOT = resolve(import.meta.dir, '../..');
export const BUN = join(REPO_ROOT, 'node_modules/bun/bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
export const HOST_ENTRY = join(REPO_ROOT, 'src/host/index.ts');
export const PROTOCOL_VERSION = 90;

export interface HostFixture {
  root: string;
  repo: string;
  dataDir: string;
  piDir: string;
  homeDir: string;
  env: Record<string, string>;
  provider: Awaited<ReturnType<typeof startFixtureProvider>>;
  /** Closes the loopback provider; reports a stalled listener instead of hiding it. */
  closeProvider(): Promise<Error[]>;
  removeRoot(): Error[];
}

// Only what the OS and the host need to start: no shell profile, no model API keys, no user config.
const POSIX_ENV_KEYS = ['PATH', 'TMPDIR', 'TZ', 'LANG', 'LC_ALL', 'SHELL', 'TERM'];
const WINDOWS_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'ComSpec',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'TEMP',
  'TMP',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'ProgramData',
  'USERDOMAIN',
  'COMPUTERNAME',
  'SESSIONNAME',
];

function runGit(cwd: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`git ${args.join(' ')} exited ${code}: ${output.slice(-2000)}`));
    });
  });
}

export function walkFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, found);
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

export async function createHostFixture(): Promise<HostFixture> {
  const root = mkdtempSync(join(tmpdir(), 'aster-host-'));
  const repo = join(root, 'repo');
  const dataDir = join(root, 'data');
  const piDir = join(root, 'pi');
  const homeDir = join(root, 'home');
  const appData = join(homeDir, 'AppData');
  for (const directory of [
    repo,
    dataDir,
    piDir,
    homeDir,
    join(homeDir, '.claude'),
    join(homeDir, '.codex'),
    join(homeDir, '.gemini'),
    join(homeDir, '.config'),
    join(homeDir, '.local', 'share'),
    join(homeDir, '.cache'),
    join(appData, 'Roaming'),
    join(appData, 'Local'),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(join(homeDir, '.gitconfig'), '');
  writeFileSync(join(repo, 'fixture-read.txt'), 'ASTER_HOST_READ_OK\n');
  const env: Record<string, string> = {};
  for (const key of process.platform === 'win32' ? WINDOWS_ENV_KEYS : POSIX_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const homeDrive = homeDir.slice(0, 2);
  Object.assign(env, {
    THINKRAIL_DATA_DIR: dataDir,
    PI_CODING_AGENT_DIR: piDir,
    THINKRAIL_PICK_DIR: repo,
    NODE_ENV: 'test',
    PI_OFFLINE: '1',
    ASTER_DESKTOP_PARENT: '1',
    HOME: homeDir,
    USERPROFILE: homeDir,
    HOMEDRIVE: homeDrive,
    HOMEPATH: homeDir.slice(2),
    APPDATA: join(appData, 'Roaming'),
    LOCALAPPDATA: join(appData, 'Local'),
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    XDG_DATA_HOME: join(homeDir, '.local', 'share'),
    XDG_CACHE_HOME: join(homeDir, '.cache'),
    XDG_STATE_HOME: join(homeDir, '.local', 'state'),
    CLAUDE_CONFIG_DIR: join(homeDir, '.claude'),
    CODEX_HOME: join(homeDir, '.codex'),
    GEMINI_CLI_HOME: homeDir,
    GIT_CONFIG_GLOBAL: join(homeDir, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  });
  // Identity travels on the single commit; no repository or global git config is written.
  await runGit(repo, ['init', '-q'], env);
  await runGit(repo, ['add', '.'], env);
  await runGit(repo, [
    '-c', 'user.name=Aster Fixture',
    '-c', 'user.email=aster-fixture@example.invalid',
    'commit', '-q', '-m', 'fixture repository',
  ], env);
  const provider = await startFixtureProvider();
  writeFileSync(join(piDir, 'models.json'), JSON.stringify(fixtureModelsJson(provider.baseUrl), null, 2));
  const skillDir = join(piDir, 'skills', 'greet');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: greet\ndescription: Fixture greeting skill for host tests\n---\n\nASTER_SKILL_FIXTURE_MARKER\n',
  );
  let providerClosed = false;
  let rootRemoved = false;
  return {
    root,
    repo,
    dataDir,
    piDir,
    homeDir,
    env,
    provider,
    closeProvider: async () => {
      if (providerClosed) return [];
      providerClosed = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const failure = await Promise.race<Error | null>([
        provider.close().then(() => null, (error: unknown) => toError(error)),
        new Promise<Error | null>(resolvePromise => {
          timer = setTimeout(() => resolvePromise(new Error('Fixture provider listener did not close within 10s')), 10_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return failure ? [failure] : [];
    },
    removeRoot: () => {
      if (rootRemoved) return [];
      rootRemoved = true;
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        return [];
      } catch (error) {
        return [toError(error)];
      }
    },
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface HostProcess {
  child: ChildProcessWithoutNullStreams;
  port: number;
  stderr(): string;
  stop(): Promise<void>;
}

function settledWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>(resolvePromise => { timer = setTimeout(() => resolvePromise(false), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

export async function startHost(env: Record<string, string>): Promise<HostProcess> {
  const child = spawn(BUN, [HOST_ENTRY], {
    cwd: REPO_ROOT,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  child.stdin.on('error', () => {});
  let closed = false;
  const closedPromise = new Promise<void>(resolvePromise => {
    child.once('close', () => { closed = true; resolvePromise(); });
  });
  const stopChild = async (): Promise<string | null> => {
    if (!closed) {
      child.kill();
      if (!(await settledWithin(closedPromise, 10_000))) return 'the host process did not exit within 10s of being killed';
    }
    return null;
  };
  let readySettled = false;
  const port = await new Promise<number>((resolvePromise, reject) => {
    let output = '';
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const detach = () => {
      child.stdout.off('data', onStdout);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const fail = async (error: Error): Promise<void> => {
      if (readySettled) return;
      readySettled = true;
      if (readyTimer) clearTimeout(readyTimer);
      detach();
      // Reap only the child this attempt spawned; nothing is cleaned by process name.
      const reapFailure = await stopChild();
      reject(reapFailure ? new Error(`${error.message}\nAlso: ${reapFailure}`) : error);
    };
    const onStdout = (chunk: string | Buffer) => {
      output += chunk;
      const line = output.split(/\r?\n/).find(candidate => candidate.startsWith('ASTER_HOST_READY '));
      if (!line || readySettled) return;
      let readyPort: number;
      try {
        const ready = JSON.parse(line.slice('ASTER_HOST_READY '.length)) as { port?: unknown };
        if (typeof ready.port !== 'number' || !Number.isInteger(ready.port)) throw new Error(`Invalid ready payload: ${line}`);
        readyPort = ready.port;
      } catch (error) {
        void fail(toError(error));
        return;
      }
      readySettled = true;
      if (readyTimer) clearTimeout(readyTimer);
      detach();
      resolvePromise(readyPort);
    };
    const onError = (error: Error) => { void fail(error); };
    const onExit = (code: number | null) => {
      void fail(new Error(`The ThinkRail host exited during startup (${code}).\n${output.slice(-4000)}\n${stderr}`));
    };
    readyTimer = setTimeout(() => {
      void fail(new Error(`The ThinkRail host did not print ASTER_HOST_READY within 90s.\n${output.slice(-4000)}\n${stderr}`));
    }, 90_000);
    child.stdout.on('data', onStdout);
    child.once('error', onError);
    child.once('exit', onExit);
  }).catch(async (error: unknown) => {
    // A throw outside fail() still must reap the child this attempt spawned, bounded in time.
    const reapFailure = await stopChild();
    const base = toError(error);
    throw reapFailure ? new Error(`${base.message}\nAlso: ${reapFailure}`) : base;
  });
  let stopped = false;
  return {
    child,
    port,
    stderr: () => stderr,
    stop: async () => {
      if (stopped) return;
      if (child.exitCode === null) {
        try { child.stdin.end('shutdown\n'); } catch { /* stdin already gone: exit check below decides */ }
        if (!(await settledWithin(closedPromise, 15_000))) {
          child.kill();
          if (!(await settledWithin(closedPromise, 5_000))) {
            throw new Error(`The ThinkRail host did not stop gracefully.\n${stderr.slice(-4000)}`);
          }
        }
      } else {
        await closedPromise;
      }
      if (child.exitCode === null) throw new Error(`The ThinkRail host has not exited.\n${stderr.slice(-4000)}`);
      stopped = true;
    },
  };
}

type Frame = {
  channel?: string;
  data?: unknown;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
};

interface Waiter {
  timer: ReturnType<typeof setTimeout>;
  matches(frame: Frame): boolean;
  resolve(frame: Frame): void;
}

/** Minimal protocol-90 client: one JSON line per request, responses by id, pushes by channel. */
export class HostConnection {
  readonly frames: Frame[] = [];
  private readonly socket: WebSocket;
  private readonly waiters = new Set<Waiter>();
  private readonly pending = new Map<string, { resolve(frame: Frame): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private sequence = 0;

  private createTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  private constructor(socket: WebSocket) {
    this.socket = socket;
    // Attached before the upgrade completes so the welcome push cannot race the open event.
    socket.addEventListener('message', event => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      this.frames.push(frame);
      if (frame.id !== undefined) {
        // Upstream frees the replay-cache entry only when the client acknowledges the response id.
        try { this.socket.send(JSON.stringify({ ack: [frame.id] })); } catch { /* closing socket */ }
        const request = this.pending.get(frame.id);
        if (request) {
          this.pending.delete(frame.id);
          this.clearTimer(request.timer);
          request.resolve(frame);
        }
      }
      for (const waiter of this.waiters) {
        if (!waiter.matches(frame)) continue;
        this.waiters.delete(waiter);
        this.clearTimer(waiter.timer);
        waiter.resolve(frame);
      }
    });
  }

  static async connect(port: number, client = `aster-test-${Math.random().toString(36).slice(2)}`): Promise<HostConnection> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?client=${encodeURIComponent(client)}&protocol=${PROTOCOL_VERSION}`);
    const connection = new HostConnection(socket);
    await connection.waitOpen();
    return connection;
  }

  private waitOpen(): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        resolvePromise();
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (error?: Error) => {
        if (timer) clearTimeout(timer);
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onError);
        if (error) reject(error);
        else resolvePromise();
      };
      const onOpen = () => settle();
      const onError = () => settle(new Error('WebSocket upgrade failed'));
      timer = setTimeout(() => settle(new Error('WebSocket upgrade timed out')), 15_000);
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('error', onError);
    });
  }

  request<T = any>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    const id = `req-${++this.sequence}`;
    return new Promise<T>((resolvePromise, reject) => {
      const timer = this.createTimer(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} (${id})`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: frame => {
          if (frame.ok !== true) {
            reject(new Error(`${method} failed: ${frame.error ?? 'unknown error'}${frame.errorCode ? ` [${frame.errorCode}]` : ''}`));
            return;
          }
          resolvePromise(frame.result as T);
        },
        timer,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor<T = any>(matches: (frame: Frame) => boolean, timeoutMs = 60_000): Promise<T> {
    const existing = this.frames.find(matches);
    if (existing) return Promise.resolve(existing as T);
    return this.waitFrom(this.frames.length, matches, timeoutMs);
  }

  /** Ignores frames already received; use for events that repeat across turns. */
  waitForNext<T = any>(matches: (frame: Frame) => boolean, timeoutMs = 60_000): Promise<T> {
    return this.waitFrom(this.frames.length, matches, timeoutMs);
  }

  private waitFrom<T>(start: number, matches: (frame: Frame) => boolean, timeoutMs: number): Promise<T> {
    const alreadyReceived = this.frames.slice(start).find(matches);
    if (alreadyReceived) return Promise.resolve(alreadyReceived as T);
    return new Promise<T>((resolvePromise, reject) => {
      const waiter: Waiter = {
        timer: this.createTimer(() => {
          this.waiters.delete(waiter);
          reject(new Error('Timed out waiting for a matching server push'));
        }, timeoutMs),
        matches: frame => this.frames.indexOf(frame) >= start && matches(frame),
        resolve: frame => {
          this.clearTimer(waiter.timer);
          resolvePromise(frame as T);
        },
      };
      this.waiters.add(waiter);
    });
  }

  /** Frame count to pass to waitForEventFrom so an event that raced the request is still seen. */
  mark(): number {
    return this.frames.length;
  }

  waitForEventFrom(start: number, sessionId: string, type: string, timeoutMs = 60_000): Promise<any> {
    return this.waitFrom(
      start,
      frame => frame.channel === 'pi.event'
        && (frame.data as { sessionId?: string } | undefined)?.sessionId === sessionId
        && (frame.data as { event?: { type?: string } } | undefined)?.event?.type === type,
      timeoutMs,
    ).then(frame => (frame.data as { event: unknown }).event);
  }

  close(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.waiters.clear();
    this.socket.close();
  }
}

/** Cleanup failures are returned so a test failure stays primary without hiding the cause. */
export async function teardownHostFixture(parts: {
  connection?: HostConnection;
  host?: HostProcess;
  fixture: HostFixture;
}): Promise<Error[]> {
  const errors: Error[] = [];
  try { parts.connection?.close(); } catch (error) { errors.push(toError(error)); }
  let hostExitProblem: string | null = null;
  if (parts.host) {
    try {
      await parts.host.stop();
    } catch (error) {
      errors.push(toError(error));
    }
    if (parts.host.child.exitCode === null && parts.host.child.signalCode === null) hostExitProblem = 'the host process did not exit';
  } else {
    hostExitProblem = 'no host process handle was retained, so its exit cannot be confirmed';
  }
  const providerErrors = await parts.fixture.closeProvider();
  errors.push(...providerErrors);
  const keepReason = [
    ...(hostExitProblem ? [hostExitProblem] : []),
    ...(providerErrors.length > 0 ? ['the fixture provider listener did not close cleanly'] : []),
  ];
  if (keepReason.length > 0) {
    errors.push(new Error(`Fixture root kept because ${keepReason.join(' and ')}: ${parts.fixture.root}`));
    return errors;
  }
  errors.push(...parts.fixture.removeRoot());
  return errors;
}

export async function finishHostTest(
  parts: { connection?: HostConnection; host?: HostProcess; fixture: HostFixture },
  primaryFailure: unknown,
): Promise<void> {
  const errors = await teardownHostFixture(parts);
  if (errors.length === 0) return;
  const detail = errors.map(error => error.stack ?? error.message).join('\n');
  if (primaryFailure !== undefined) {
    console.error(`Host fixture cleanup failed after the test failure:\n${detail}`);
    return;
  }
  throw new Error(`Host fixture cleanup failed:\n${detail}`);
}

export function expectNoSqlite(root: string): string[] {
  return walkFiles(root).filter(path => /\.(sqlite3?|db)(-wal|-shm)?$/i.test(path));
}

export function readSessionJsonl(piDir: string): { path: string; lines: any[] } {
  const directory = join(piDir, 'sessions');
  if (!existsSync(directory)) throw new Error(`Pi sessions directory is missing: ${directory}`);
  const files = walkFiles(directory).filter(path => path.endsWith('.jsonl'));
  if (files.length !== 1) throw new Error(`Expected exactly one Pi session JSONL, found ${files.length}: ${files.join(', ')}`);
  const lines = readFileSync(files[0], 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  return { path: files[0], lines };
}

export function findSessionJsonl(piDir: string, sessionId: string): string {
  const directory = join(piDir, 'sessions');
  const match = walkFiles(directory).find(path => path.endsWith(`_${sessionId}.jsonl`));
  if (!match) throw new Error(`No native Pi JSONL for session ${sessionId} under ${directory}`);
  return match;
}
