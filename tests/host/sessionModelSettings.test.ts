import { expect, test } from 'bun:test';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { isSessionModelSettingsResult, type WireModel } from '../../vendor/thinkrail/packages/contracts/src/index';
import { createHostFixture, finishHostTest, HostConnection, startHost } from './hostHarness';

test('model and thinking acknowledgements report live Pi settings, including clamped and unchanged levels', async () => {
  const fixture = await createHostFixture();
  const relativeRoot = relative(realpathSync.native(tmpdir()), fixture.root);
  if (!relativeRoot.startsWith('aster-host-') || relativeRoot.includes('..') || isAbsolute(relativeRoot)) {
    throw new Error('Unexpected isolated fixture root; refusing cleanup');
  }
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let connection: HostConnection | undefined;
  let failure: unknown;
  try {
    const modelsPath = join(fixture.piDir, 'models.json');
    const config = JSON.parse(readFileSync(modelsPath, 'utf8'));
    const reasoningModel = config.providers.fixture.models[0];
    config.providers.fixture.models.push({ ...reasoningModel, id: 'basic-model', name: 'Basic fixture', reasoning: false });
    writeFileSync(modelsPath, JSON.stringify(config));

    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const project = await connection.request<{ id: string }>('project.open', { path: fixture.repo });
    const [workspace] = await connection.request<Array<{ id: string }>>('workspace.list', { projectId: project.id });
    const models = await connection.request<WireModel[]>('model.list', {});
    const reasoning = models.find(model => model.id === 'fixture-model');
    const basic = models.find(model => model.id === 'basic-model');
    if (!reasoning || !basic) throw new Error('Fixture models missing');
    expect(reasoning.thinkingLevels).not.toContain('max');
    expect(basic.thinkingLevels).toEqual(['off']);

    const created = await connection.request<{ sessionId: string; thinkingLevel: string }>('session.create', {
      workspaceId: workspace.id, model: reasoning, thinkingLevel: 'medium',
    });
    expect(created.thinkingLevel).toBe('medium');
    const sessionId = created.sessionId;

    const changeMark = connection.mark();
    const clamped = await connection.request<unknown>('session.setThinkingLevel', { sessionId, level: 'max' });
    expect(isSessionModelSettingsResult(clamped)).toBe(true);
    expect(clamped).toMatchObject({ ok: true, model: { id: 'fixture-model' }, thinkingLevel: 'high' });
    const changeFrames = connection.frames.slice(changeMark);
    const eventIndex = changeFrames.findIndex(frame => frame.channel === 'pi.event' &&
      (frame.data as { event?: { type?: string; level?: string } }).event?.type === 'thinking_level_changed' &&
      (frame.data as { event?: { type?: string; level?: string } }).event?.level === 'high');
    const ackIndex = changeFrames.findIndex(frame => frame.id !== undefined);
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    expect(ackIndex).toBeGreaterThan(eventIndex);

    const mark = connection.mark();
    const unchanged = await connection.request<unknown>('session.setThinkingLevel', { sessionId, level: 'max' });
    expect(unchanged).toMatchObject({ ok: true, model: { id: 'fixture-model' }, thinkingLevel: 'high' });
    expect(connection.frames.slice(mark).some(frame => frame.channel === 'pi.event' &&
      (frame.data as { event?: { type?: string } }).event?.type === 'thinking_level_changed')).toBe(false);

    const staleModel = { ...basic, name: 'Stale name', reasoning: true, thinkingLevels: ['off', 'high', 'max'] };
    const changed = await connection.request<unknown>('session.setModel', { sessionId, model: staleModel });
    expect(isSessionModelSettingsResult(changed)).toBe(true);
    expect(changed).toMatchObject({ ok: true, model: { id: 'basic-model', name: 'Basic fixture', reasoning: false, thinkingLevels: ['off'] }, thinkingLevel: 'off' });
    const staleChoice = await connection.request<unknown>('session.setThinkingLevel', { sessionId, level: 'high' });
    expect(staleChoice).toMatchObject({ ok: true, model: { id: 'basic-model', thinkingLevels: ['off'] }, thinkingLevel: 'off' });

    const summaries = await connection.request<Array<{ sessionId: string; live: boolean; model: WireModel | null; thinkingLevel: string }>>('session.list', { workspaceId: workspace.id });
    const summary = summaries.find(item => item.sessionId === sessionId);
    expect(summary).toMatchObject({ live: true, model: { id: 'basic-model' }, thinkingLevel: 'off' });
    await expect(connection.request('session.setThinkingLevel', { sessionId: 'missing', level: 'high' })).rejects.toThrow();
    expect(fixture.provider.requests).toHaveLength(0);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await finishHostTest({ connection, host, fixture }, failure);
  }
}, 120_000);
