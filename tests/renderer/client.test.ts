import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@thinkrail/contracts';
import {
  ClientDisconnectedError,
  ClientRequestError,
  WsClient,
  resolveWsUrl,
} from '../../src/renderer/client';

type Frame = Record<string, unknown>;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  frames(): Frame[] {
    return this.sent.map(frame => JSON.parse(frame) as Frame);
  }
}

function latest(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error('no socket was created');
  return socket;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('same-origin websocket endpoint', () => {
  test('targets /ws with the protocol version and one stable client id', () => {
    const http = new URL(resolveWsUrl('http://127.0.0.1:4310/index.html'));
    expect(http.pathname).toBe('/ws');
    expect(http.protocol).toBe('ws:');
    expect(http.searchParams.get('protocol')).toBe(String(PROTOCOL_VERSION));
    expect(http.searchParams.get('client')).toMatch(/^[0-9a-f-]{36}$/);

    const https = new URL(resolveWsUrl('https://aster.local/'));
    expect(https.protocol).toBe('wss:');
    expect(https.searchParams.get('client')).toBe(http.searchParams.get('client'));
  });
});

describe('request correlation', () => {
  test('resolves out-of-order responses to their own request and acknowledges both', async () => {
    const client = new WsClient({ url: 'ws://aster.test/ws', reconnect: false });
    client.connect();
    const socket = latest();
    socket.open();

    const projects = client.request('project.list', {});
    const models = client.request('model.list', {});
    const frames = socket.frames();
    expect(frames).toHaveLength(2);
    const projectId = frames[0].id as string;
    const modelId = frames[1].id as string;
    expect(projectId).not.toBe(modelId);
    expect(frames[1]).toMatchObject({ method: 'model.list', params: {} });

    socket.receive({ id: modelId, ok: true, result: [{ id: 'm1' }] });
    await expect(models).resolves.toEqual([{ id: 'm1' }]);
    await Promise.resolve();
    expect(socket.frames().at(-1)).toEqual({ ack: [modelId] });

    socket.receive({ id: projectId, ok: true, result: [] });
    await expect(projects).resolves.toEqual([]);
    await Promise.resolve();
    expect(socket.frames().at(-1)).toEqual({ ack: [projectId] });

    client.close();
  });

  test('surfaces the host error text and code', async () => {
    const client = new WsClient({ url: 'ws://aster.test/ws', reconnect: false });
    client.connect();
    const socket = latest();
    socket.open();

    const request = client.request('session.prompt', { sessionId: 's1', text: 'hi' });
    const id = socket.frames()[0].id as string;
    socket.receive({ id, ok: false, error: 'not a git repository', errorCode: 'NOT_GIT' });
    await expect(request).rejects.toBeInstanceOf(ClientRequestError);
    await expect(request).rejects.toMatchObject({ code: 'NOT_GIT', message: 'not a git repository' });

    client.close();
  });

  test('answers a blocking extension dialog through the native reply method', async () => {
    const client = new WsClient({ url: 'ws://aster.test/ws', reconnect: false });
    client.connect();
    const socket = latest();
    socket.open();

    const reply = client.request('session.extUiReply', { response: { id: 'ask-1', value: 'staging' } });
    const frame = socket.frames()[0];
    expect(frame).toMatchObject({ method: 'session.extUiReply', params: { response: { id: 'ask-1', value: 'staging' } } });
    socket.receive({ id: frame.id, ok: true, result: { ok: true } });
    await expect(reply).resolves.toEqual({ ok: true });
    await Promise.resolve();
    expect(socket.frames().at(-1)).toEqual({ ack: [frame.id] });

    client.close();
  });
});

describe('disconnects', () => {
  test('fails an in-flight request and never replays it after reconnecting', async () => {
    vi.useFakeTimers();
    const client = new WsClient({ url: 'ws://aster.test/ws', reconnect: true });
    client.connect();
    const first = latest();
    first.open();

    const prompt = client.request('session.prompt', { sessionId: 's1', text: 'run once' });
    expect(first.frames()).toHaveLength(1);

    first.close();
    await expect(prompt).rejects.toBeInstanceOf(ClientDisconnectedError);
    await expect(prompt).rejects.toMatchObject({ method: 'session.prompt' });

    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = latest();
    second.open();
    expect(second.sent).toEqual([]);

    const projects = client.request('project.list', {});
    expect(second.frames()).toHaveLength(1);
    expect(second.frames()[0].method).toBe('project.list');
    const id = second.frames()[0].id as string;
    second.receive({ id, ok: true, result: [] });
    await expect(projects).resolves.toEqual([]);

    client.close();
  });

  test('rejects new requests while there is no open socket', async () => {
    const client = new WsClient({ url: 'ws://aster.test/ws', reconnect: false });
    client.connect();
    const socket = latest();
    socket.open();
    socket.close();

    await expect(client.request('session.abort', { sessionId: 's1' })).rejects.toBeInstanceOf(ClientDisconnectedError);
    await expect(client.request('session.abort', { sessionId: 's1' })).rejects.toMatchObject({ method: 'session.abort' });
    client.close();
  });
});

describe('push subscriptions', () => {
  test('delivers each channel payload to its subscribers only', () => {
    const client = new WsClient({ url: 'ws://aster.test/ws', reconnect: false });
    const states: unknown[] = [];
    const events: unknown[] = [];
    const offStates = client.subscribe('session.state', data => states.push(data));
    client.subscribe('pi.event', data => events.push(data));
    client.connect();
    const socket = latest();
    socket.open();

    socket.receive({ channel: 'session.state', data: { sessionId: 's1' } });
    expect(states).toEqual([{ sessionId: 's1' }]);
    expect(events).toEqual([]);

    offStates();
    socket.receive({ channel: 'session.state', data: { sessionId: 's2' } });
    expect(states).toHaveLength(1);

    client.close();
  });
});
