import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

process.env.THINKRAIL_DATA_DIR ??= join(homedir(), '.aster');
const { bootHost } = await import('../../vendor/thinkrail/packages/server/src/index');
const requestedPort = Number(process.env.ASTER_HOST_PORT ?? 0);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid local host port.');
const host = await bootHost({
  host: '127.0.0.1', port: requestedPort, portMode: 'exact',
  staticDir: resolve(import.meta.dir, '../../out/desktop/renderer'),
  appVersion: '0.1.0', resolveShellEnv: true,
  analytics: { channel: 'dev', build: 'source', posthogApiKey: '', mute: true },
});
console.log(`ASTER_HOST_READY ${JSON.stringify({ port: host.port })}`);

if (process.env.ASTER_DESKTOP_PARENT === '1') {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try { await host.server.shutdown(); process.exit(0); }
    catch (error) { console.error('Host shutdown failed.', error instanceof Error ? error.name : 'UnknownError'); process.exit(1); }
  };
  const input = createInterface({ input: process.stdin });
  input.on('line', line => { if (line === 'shutdown') void shutdown(); });
  input.on('close', () => { void shutdown(); });
}
