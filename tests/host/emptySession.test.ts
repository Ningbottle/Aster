import { expect, test } from 'bun:test';
import { createHostFixture, finishHostTest, HostConnection, readSessionJsonl, startHost } from './hostHarness';

test('an empty native session survives a host restart with the same ID and accepts its first real turn', async () => {
  const fixture = await createHostFixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let connection: HostConnection | undefined;
  let failure: unknown;
  try {
    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const project = await connection.request<{ id: string }>('project.open', { path: fixture.repo });
    const [workspace] = await connection.request<Array<{ id: string }>>('workspace.list', { projectId: project.id, includeDiffStats: false });
    const { sessionId, thinkingLevel } = await connection.request<{ sessionId: string; thinkingLevel: string }>('session.create', { workspaceId: workspace.id, thinkingLevel: 'high' });
    expect(thinkingLevel).toBe('high');
    const native = readSessionJsonl(fixture.piDir);
    expect(native.lines[0]).toMatchObject({ type: 'session', id: sessionId });
    expect(native.lines.some(entry => entry.type === 'message')).toBe(false);
    expect(fixture.provider.requests).toHaveLength(0);
    connection.close(); connection = undefined;
    await host.stop(); host = undefined;

    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const listed = await connection.request<Array<{ sessionId: string; messageCount: number }>>('session.list', { workspaceId: workspace.id });
    expect(listed.find(session => session.sessionId === sessionId)).toMatchObject({ messageCount: 0 });
    const reopened = await connection.request<{ summary: { sessionId: string; model: { id: string }; thinkingLevel: string; approvalMode: string }; messages: unknown[] }>('session.getMessages', { sessionId, workspaceId: workspace.id });
    expect(reopened.summary).toMatchObject({ sessionId, model: { id: 'fixture-model' }, thinkingLevel: 'high', approvalMode: 'auto' });
    expect(reopened.messages).toEqual([]);
    const usage = await connection.request<{ sessions: number; totalTokens: number }>('usage.getSummary', { range: 'all', timeZone: 'UTC' });
    expect(usage.sessions).toBe(0);
    expect(usage.totalTokens).toBe(0);

    const mark = connection.mark();
    await connection.request('session.prompt', { sessionId, text: 'ASTER_HOST_TOOL_FIXTURE inspect the fixture file' });
    await connection.waitForEventFrom(mark, sessionId, 'agent_settled', 90_000);
    const after = readSessionJsonl(fixture.piDir);
    expect(after.lines[0].id).toBe(sessionId);
    expect(after.lines.some(entry => entry.type === 'message' && entry.message?.role === 'user')).toBe(true);
    expect(fixture.provider.requests).toHaveLength(2);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await finishHostTest({ connection, host, fixture }, failure);
  }
}, 240_000);
