import {
  PROTOCOL_VERSION,
  type WsErrorCode,
  type WsMethodName,
  type WsParams,
  type WsResult,
  type WsServerMessage,
} from '@thinkrail/contracts';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const OPEN = 1;
const DEFAULT_TIMEOUT_MS = 60_000;
/** Bun's default WebSocket payload cap is 16 MiB; keep headroom for the request envelope. */
const DEFAULT_MAX_FRAME_BYTES = 15 * 1024 * 1024;
const textEncoder = new TextEncoder();

function frameSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ClientRequestError extends Error {
  readonly code: WsErrorCode | undefined;

  constructor(message: string, code?: WsErrorCode) {
    super(message);
    this.name = 'ClientRequestError';
    this.code = code;
  }
}

/** Requests in flight when the socket drops are failed, never replayed: a replayed prompt or write could run twice. */
export class ClientDisconnectedError extends Error {
  readonly method: string | null;

  constructor(method: string | null) {
    super(method ? `Disconnected before "${method}" completed` : 'Disconnected from the local server');
    this.name = 'ClientDisconnectedError';
    this.method = method;
  }
}

export interface WsClientOptions {
  url?: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
  reconnect?: boolean;
}

export interface RequestOptions {
  sessionId?: string;
  timeoutMs?: number;
}

interface PendingRequest {
  method: WsMethodName;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let clientId: string | null = null;

/** The server keys resumable per-client state on `client`; one page is one client. */
function pageClientId(): string {
  clientId ??= crypto.randomUUID();
  return clientId;
}

export function resolveWsUrl(href: string): string {
  const url = new URL('/ws', href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('protocol', String(PROTOCOL_VERSION));
  url.searchParams.set('client', pageClientId());
  return url.toString();
}

export class WsClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly reconnect: boolean;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Map<string, Set<(data: unknown) => void>>();
  private readonly statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private socket: WebSocket | null = null;
  private sequence = 0;
  private ackQueue: string[] = [];
  private ackScheduled = false;
  private backoff = 500;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private status: ConnectionStatus = 'disconnected';

  constructor(options: WsClientOptions = {}) {
    this.url = options.url ?? resolveWsUrl(location.href);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.reconnect = options.reconnect ?? true;
  }

  connect(): void {
    this.stopped = false;
    if (this.socket) return;
    this.setStatus('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.backoff = 500;
      this.setStatus('connected');
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failPending(null);
      this.setStatus('disconnected');
      this.scheduleRetry();
    };
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.failPending(null);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.setStatus('disconnected');
  }

  onStatus(handler: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  request<M extends WsMethodName>(method: M, params: WsParams<M>, options: RequestOptions = {}): Promise<WsResult<M>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return Promise.reject(new ClientDisconnectedError(method));
    const id = `aster_${++this.sequence}`;
    const frame = JSON.stringify({
      id,
      method,
      params,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    });
    const bytes = textEncoder.encode(frame).byteLength;
    if (bytes > this.maxFrameBytes) {
      return Promise.reject(new ClientRequestError(
        `"${method}" is ${frameSize(bytes)}; the local transport limit is ${frameSize(this.maxFrameBytes)}. Remove attachments or shorten the message.`,
      ));
    }
    return new Promise<WsResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ClientRequestError(`"${method}" timed out`));
      }, options.timeoutMs ?? this.timeoutMs);
      this.pending.set(id, {
        method,
        resolve: value => resolve(value as WsResult<M>),
        reject,
        timer,
      });
      socket.send(frame);
    });
  }

  subscribe(channel: string, handler: (data: unknown) => void): () => void {
    let handlers = this.subscribers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(channel, handlers);
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  private scheduleRetry(): void {
    if (this.stopped || !this.reconnect || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 10_000);
  }

  private failPending(method: WsMethodName | null): void {
    if (this.pending.size === 0) return;
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new ClientDisconnectedError(method ?? entry.method));
    }
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: WsServerMessage;
    try {
      message = JSON.parse(raw) as WsServerMessage;
    } catch {
      return;
    }
    if ('channel' in message) {
      const handlers = this.subscribers.get(message.channel);
      if (handlers) for (const handler of handlers) handler(message.data);
      return;
    }
    this.queueAck(message.id);
    const entry = this.pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }
    entry.reject(new ClientRequestError(message.error ?? `"${entry.method}" failed`, message.errorCode));
  }

  private queueAck(id: string): void {
    this.ackQueue.push(id);
    if (this.ackScheduled) return;
    this.ackScheduled = true;
    queueMicrotask(() => {
      this.ackScheduled = false;
      const ack = this.ackQueue;
      this.ackQueue = [];
      if (ack.length === 0) return;
      const socket = this.socket;
      if (!socket || socket.readyState !== OPEN) return;
      socket.send(JSON.stringify({ ack }));
    });
  }
}
