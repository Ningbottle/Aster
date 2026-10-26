import { expect, test } from 'bun:test';
import { createHostFixture, finishHostTest, HostConnection, startHost } from './hostHarness';

test('host rejects cross-origin and foreign-host requests before any protocol work', async () => {
  const fixture = await createHostFixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let connection: HostConnection | undefined;
  let failure: unknown;
  try {
    host = await startHost(fixture.env);
    const port = host.port;
    const url = `http://127.0.0.1:${port}/health`;
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url, { headers: { origin: `http://127.0.0.1:${port}` } })).status).toBe(200);
    expect((await fetch(url, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(url, { headers: { origin: 'null' } })).status).toBe(403);
    expect((await fetch(url, { headers: { host: 'evil.example' } })).status).toBe(403);

    const rejected = await new Promise<string>((resolvePromise, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/ws?client=evil&protocol=90`,
        { headers: { origin: 'http://evil.example' } } as never,
      );
      socket.addEventListener('open', () => reject(new Error('Cross-origin WebSocket upgrade unexpectedly succeeded')), { once: true });
      socket.addEventListener('error', () => resolvePromise('upgrade rejected'), { once: true });
      setTimeout(() => reject(new Error('Cross-origin WebSocket attempt timed out')), 10_000);
    });
    expect(rejected).toBe('upgrade rejected');

    connection = await HostConnection.connect(port, 'same-origin');
    const welcome = await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    expect((welcome.data as { protocolVersion?: number }).protocolVersion).toBe(90);
    expect(await connection.request('project.list', {})).toEqual([]);
    expect(host.stderr()).not.toContain('Forbidden origin');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await finishHostTest({ connection, host, fixture }, failure);
  }
}, 180_000);
