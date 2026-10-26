import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createHostFixture,
  expectNoSqlite,
  findSessionJsonl,
  finishHostTest,
  HostConnection,
  startHost,
} from './hostHarness';
import { FIXTURE_MARKERS } from '../fixtures/fixture-provider.mjs';

async function waitForProviderEvent(events: Array<{ type: string }>, type: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some(event => event.type === type)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Provider fixture never recorded ${type}`);
}

test('Pi skill command expands natively and session.abort closes the provider stream', async () => {
  const fixture = await createHostFixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let connection: HostConnection | undefined;
  let failure: unknown;
  try {
    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const project = await connection.request<{ id: string }>('project.open', { path: fixture.repo });
    const workspaces = await connection.request<Array<{ id: string }>>('workspace.list', { projectId: project.id });
    const workspaceId = workspaces[0].id;

    const skillSession = await connection.request<{ sessionId: string }>('session.create', { workspaceId });
    const commands = await connection.request<Array<{
      name: string;
      description?: string;
      source: string;
      sourceInfo?: { path?: string; scope?: string };
    }>>('session.getCommands', { sessionId: skillSession.sessionId });
    const skillCommand = commands.find(command => command.name === 'skill:greet');
    expect(skillCommand).toBeDefined();
    expect(skillCommand?.source).toBe('skill');
    expect(skillCommand?.description).toBe('Fixture greeting skill for host tests');
    expect(skillCommand?.sourceInfo?.path).toBe(join(fixture.piDir, 'skills', 'greet', 'SKILL.md'));

    const skillMark = connection.mark();
    await connection.request('session.prompt', { sessionId: skillSession.sessionId, text: '/skill:greet' });
    const skillSettled = await connection.waitForEventFrom(skillMark, skillSession.sessionId, 'agent_settled', 90_000);
    expect(skillSettled.terminal?.stopReason).toBe('stop');
    const skillRequest = fixture.provider.requests.find(request => request.prompt.includes(FIXTURE_MARKERS.skillExpanded));
    expect(skillRequest).toBeDefined();
    expect(skillRequest?.prompt).toContain('<skill name="greet"');
    expect(skillRequest?.prompt).toContain(join(fixture.piDir, 'skills', 'greet', 'SKILL.md'));
    const skillJsonl = readFileSync(findSessionJsonl(fixture.piDir, skillSession.sessionId), 'utf8');
    expect(skillJsonl).toContain(FIXTURE_MARKERS.skillExpanded);

    const cancelSession = await connection.request<{ sessionId: string }>('session.create', { workspaceId });
    await connection.request('session.prompt', {
      sessionId: cancelSession.sessionId,
      text: 'ASTER_HOST_CANCEL_FIXTURE keep streaming until aborted',
    });
    await waitForProviderEvent(fixture.provider.events, 'cancel-request');
    expect(fixture.provider.events.some(event => event.type === 'cancel-stream-closed')).toBe(false);

    const abortMark = connection.mark();
    const abort = await connection.request<{ ok: boolean }>('session.abort', { sessionId: cancelSession.sessionId });
    expect(abort.ok).toBe(true);
    const aborted = await connection.waitForEventFrom(abortMark, cancelSession.sessionId, 'agent_settled', 60_000);
    expect(aborted.terminal?.stopReason).toBe('aborted');
    expect(aborted.terminal?.errorMessage).toBe('Request was aborted');
    await waitForProviderEvent(fixture.provider.events, 'cancel-stream-closed', 15_000);

    const transcript = await connection.request<{
      summary: { isStreaming: boolean; state?: { execution: string } };
      messages: Array<{ role: string; stopReason?: string }>;
    }>('session.getMessages', { sessionId: cancelSession.sessionId, workspaceId });
    expect(transcript.summary.isStreaming).toBe(false);
    expect(transcript.summary.state?.execution).toBe('idle');
    expect(transcript.messages.at(-1)?.role).toBe('assistant');
    expect(transcript.messages.at(-1)?.stopReason).toBe('aborted');
    const cancelJsonl = readFileSync(findSessionJsonl(fixture.piDir, cancelSession.sessionId), 'utf8');
    expect(cancelJsonl).toContain(FIXTURE_MARKERS.cancelBegin);

    const recoverMark = connection.mark();
    await connection.request('session.prompt', {
      sessionId: cancelSession.sessionId,
      text: 'ASTER_HOST_TOOL_FIXTURE recover after abort',
    });
    const recovered = await connection.waitForEventFrom(recoverMark, cancelSession.sessionId, 'agent_settled', 90_000);
    expect(recovered.terminal?.stopReason).toBe('stop');
    const recoveredMessages = await connection.request<{ messages: Array<{ role: string; content: unknown }> }>(
      'session.getMessages',
      { sessionId: cancelSession.sessionId, workspaceId },
    );
    expect(JSON.stringify(recoveredMessages.messages)).toContain(FIXTURE_MARKERS.answer);

    expect(expectNoSqlite(fixture.root)).toEqual([]);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await finishHostTest({ connection, host, fixture }, failure);
  }
}, 240_000);
