import { PROTOCOL_VERSION } from '@thinkrail/contracts';

interface HostFrame {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
  channel?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ProjectRow {
  id?: unknown;
}

interface WorkspaceRow {
  id?: unknown;
  worktreePath?: unknown;
}

const LOOKUP_TIMEOUT_MS = 8_000;

/**
 * Resolves a workspace root from the local ThinkRail host, never from the renderer.
 * The host is the authority for which workspaces exist and where they live.
 */
export interface WorkspaceRootResolver {
  resolve(workspaceId: string): Promise<string>;
  dispose(): void;
}

export function createWorkspaceRootResolver(origin: string): WorkspaceRootResolver {
  const url = new URL('/ws', origin);
  url.protocol = 'ws:';
  url.searchParams.set('protocol', String(PROTOCOL_VERSION));
  url.searchParams.set('client', `aster-main-${crypto.randomUUID()}`);

  const pending = new Map<string, PendingRequest>();
  let socket: WebSocket | null = null;
  let opening: Promise<WebSocket> | null = null;
  let sequence = 0;
  let disposed = false;

  const failPending = (error: Error): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const receive = (source: WebSocket, raw: unknown): void => {
    if (source !== socket || typeof raw !== 'string') return;
    let frame: HostFrame;
    try {
      frame = JSON.parse(raw) as HostFrame;
    } catch {
      return;
    }
    if (typeof frame.channel === 'string' || typeof frame.id !== 'string') return;
    const entry = pending.get(frame.id);
    if (!entry) return;
    pending.delete(frame.id);
    clearTimeout(entry.timer);
    if (frame.ok === true) entry.resolve(frame.result);
    else entry.reject(new Error(typeof frame.error === 'string' ? frame.error : 'The local host rejected the workspace lookup.'));
  };

  const open = (): Promise<WebSocket> => {
    if (disposed) return Promise.reject(new Error('The workspace lookup has already been disposed.'));
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
    if (opening) return opening;
    opening = new Promise<WebSocket>((resolve, reject) => {
      const candidate = new WebSocket(url);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        opening = null;
        candidate.close();
        reject(new Error('The local host did not answer the workspace lookup.'));
      }, LOOKUP_TIMEOUT_MS);
      candidate.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket = candidate;
        opening = null;
        resolve(candidate);
      }, { once: true });
      candidate.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opening = null;
        socket = null;
        reject(new Error('The local host is not reachable for the workspace lookup.'));
      }, { once: true });
      candidate.addEventListener('message', event => receive(candidate, event.data));
      candidate.addEventListener('close', () => {
        if (socket === candidate) socket = null;
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          opening = null;
          reject(new Error('The local host closed the workspace lookup.'));
        }
        failPending(new Error('The local host closed during the workspace lookup.'));
      });
    });
    return opening;
  };

  const request = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const target = await open();
    const id = `aster_main_${++sequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The local host did not answer "${method}".`));
      }, LOOKUP_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        target.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    async resolve(workspaceId: string): Promise<string> {
      if (disposed) throw new Error('The workspace lookup has already been disposed.');
      const projects = await request('project.list', {});
      if (!Array.isArray(projects)) throw new Error('The local host returned an invalid project list.');
      for (const project of projects as ProjectRow[]) {
        if (typeof project?.id !== 'string') continue;
        const workspaces = await request('workspace.list', { projectId: project.id, includeDiffStats: false });
        if (!Array.isArray(workspaces)) continue;
        const match = (workspaces as WorkspaceRow[]).find(workspace => workspace?.id === workspaceId);
        if (match && typeof match.worktreePath === 'string' && match.worktreePath.length > 0) {
          return match.worktreePath;
        }
      }
      throw new Error('The workspace is not registered with the local host.');
    },
    dispose(): void {
      disposed = true;
      failPending(new Error('The workspace lookup was disposed.'));
      const current = socket;
      socket = null;
      current?.close();
    },
  };
}
