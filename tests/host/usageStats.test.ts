import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { UsageSummary } from '../../vendor/thinkrail/packages/contracts/src/usage';
import { createHostFixture, finishHostTest, HostConnection, readSessionJsonl, startHost } from './hostHarness';

test('usage summary reads native history without attaching sessions, deduplicates forks, and rejects path injection', async () => {
  const fixture = await createHostFixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let connection: HostConnection | undefined;
  let failure: unknown;
  try {
    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const empty = await connection.request<UsageSummary>('usage.getSummary', { range: 'all', timeZone: 'UTC' });
    expect(empty).toMatchObject({ sessions: 0, messages: 0, totalTokens: 0, activeDays: 0, peakHour: null, favoriteModel: null });
    const project = await connection.request<{ id: string }>('project.open', { path: fixture.repo });
    const [workspace] = await connection.request<Array<{ id: string }>>('workspace.list', { projectId: project.id });
    const created = await connection.request<{ sessionId: string }>('session.create', { workspaceId: workspace.id });
    const mark = connection.mark();
    await connection.request('session.prompt', { sessionId: created.sessionId, text: 'ASTER_HOST_TOOL_FIXTURE' });
    await connection.waitForEventFrom(mark, created.sessionId, 'agent_settled', 90_000);
    const native = readSessionJsonl(fixture.piDir);
    const messages = native.lines.filter(line => line.type === 'message' && ['user', 'assistant'].includes(line.message?.role));
    const total = messages.filter(line => line.message.role === 'assistant').reduce((sum, line) => {
      const usage = line.message.usage;
      return sum + usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    }, 0);
    expect(total).toBeGreaterThan(0);
    const live = await connection.request<UsageSummary>('usage.getSummary', { range: 'all', timeZone: 'Asia/Shanghai' });
    expect(live.messages).toBe(messages.length);
    expect(live.totalTokens).toBe(total);
    expect(live.favoriteModel).toEqual({ provider: 'fixture', id: 'fixture-model' });

    connection.close(); connection = undefined;
    await host.stop(); host = undefined;
    // Native forks preserve inherited entry ids: copied messages must not bill twice.
    const forkId = randomUUID();
    const forkRows = native.lines.map((line, i) => i === 0 ? { ...line, id: forkId, parentSession: native.path } : line);
    writeFileSync(join(dirname(native.path), `${new Date().toISOString().replace(/[:.]/g, '-')}_${forkId}.jsonl`), forkRows.map(line => JSON.stringify(line)).join('\n') + '\n');
    // An unrelated Pi directory must not be scanned just because it exists.
    const unrelated = join(fixture.piDir, 'sessions', '--not-registered--');
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(unrelated, 'private.jsonl'), readFileSync(native.path, 'utf8').replaceAll(fixture.repo.replaceAll('\\', '\\\\'), 'not-registered'));

    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const before = await connection.request<Array<{ live: boolean }>>('session.list', { workspaceId: workspace.id });
    expect(before).toHaveLength(2);
    expect(before.every(session => !session.live)).toBe(true);
    const saved = await connection.request<UsageSummary>('usage.getSummary', { range: '7d', timeZone: 'UTC' });
    expect(saved.sessions).toBe(2);
    expect(saved.messages).toBe(messages.length);
    expect(saved.totalTokens).toBe(total);
    expect(saved.coverage).toMatchObject({ workspaceCount: 1, sessionsRead: 2, unreportedResponses: 0, issues: [] });
    const after = await connection.request<Array<{ live: boolean }>>('session.list', { workspaceId: workspace.id });
    expect(after.every(session => !session.live)).toBe(true);
    const legacyId = randomUUID();
    const legacyPath = join(dirname(native.path), `legacy_${legacyId}.jsonl`);
    writeFileSync(legacyPath, native.lines.map((line, i) => JSON.stringify(i === 0 ? { ...line, version: 2, id: legacyId } : line)).join('\n') + '\n');
    const hash = () => createHash('sha256').update(readFileSync(legacyPath)).digest('hex');
    const beforeRead = hash();
    const legacy = await connection.request<UsageSummary>('usage.getSummary', { range: 'all', timeZone: 'UTC' });
    expect(legacy.totalTokens).toBe(total);
    expect(legacy.coverage.sessionsRead).toBe(3);
    expect(hash()).toBe(beforeRead);
    for (const params of [{ range: 'invalid', timeZone: 'UTC' }, { range: 'all', timeZone: 'invalid-time-zone' }, { range: 'all', timeZone: 'UTC', path: fixture.root }]) {
      await expect(connection.request('usage.getSummary', params)).rejects.toThrow(/Invalid usage/);
    }
    // Surface incomplete coverage rather than presenting unreadable history as zero.
    writeFileSync(join(dirname(native.path), 'broken.jsonl'), '{"broken":true}\n');
    const partial = await connection.request<UsageSummary>('usage.getSummary', { range: '30d', timeZone: 'UTC' });
    expect(partial.coverage.issues).toEqual([{ workspaceId: workspace.id, code: 'UNREADABLE_WORKSPACE' }]);
    expect(fixture.provider.requests).toHaveLength(2);
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    await finishHostTest({ connection, host, fixture }, failure);
  }
}, 240_000);
