import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  createHostFixture,
  expectNoSqlite,
  finishHostTest,
  HostConnection,
  readSessionJsonl,
  REPO_ROOT,
  startHost,
} from './hostHarness';
import { FIXTURE_MARKERS } from '../fixtures/fixture-provider.mjs';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
    .join('\n');
}

test('real host: default workspace, tool turn, JSONL rename, restart reopen, no SQLite', async () => {
  const fixture = await createHostFixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let connection: HostConnection | undefined;
  let failure: unknown;
  try {
    const piVersion = JSON.parse(
      readFileSync(join(REPO_ROOT, 'vendor/thinkrail/node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8'),
    ) as { version?: string };
    expect(piVersion.version).toBe('1.2.0');

    host = await startHost(fixture.env);
    const firstPort = host.port;
    connection = await HostConnection.connect(firstPort);
    const welcome = await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    expect((welcome.data as { protocolVersion?: number }).protocolVersion).toBe(90);
    expect((welcome.data as { projects?: unknown[] }).projects).toEqual([]);

    const project = await connection.request<{ id: string; path: string; name: string }>('project.open', { path: fixture.repo });
    expect(realpathSync(project.path)).toBe(realpathSync(fixture.repo));
    expect(project.name).toBe('repo');

    const workspaces = await connection.request<Array<{ id: string; projectId: string; kind?: string; worktreePath: string }>>(
      'workspace.list',
      { projectId: project.id },
    );
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].projectId).toBe(project.id);
    expect(workspaces[0].kind).toBe('default');
    expect(realpathSync(workspaces[0].worktreePath)).toBe(realpathSync(fixture.repo));
    const workspaceId = workspaces[0].id;

    const created = await connection.request<{
      sessionId: string;
      model: { provider: string; id: string; thinkingLevels: string[] } | null;
      thinkingLevel: string;
    }>('session.create', { workspaceId });
    expect(created.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.model).not.toBeNull();
    expect(created.model?.provider).toBe('fixture');
    expect(created.model?.id).toBe('fixture-model');
    expect(created.thinkingLevel).toBe('medium');
    const sessionId = created.sessionId;

    const settleMark = connection.mark();
    await connection.request('session.prompt', { sessionId, text: 'ASTER_HOST_TOOL_FIXTURE inspect the fixture file' });
    const settled = await connection.waitForEventFrom(settleMark, sessionId, 'agent_settled', 90_000);
    expect(settled.terminal?.stopReason).toBe('stop');

    const piFrames = connection.frames.filter(frame => frame.channel === 'pi.event');
    const updates = piFrames.map(frame => (frame.data as { event: any }).event);
    expect(
      updates.some(event => event.type === 'message_update' && event.assistantMessageEvent?.type === 'thinking_delta'),
    ).toBe(true);
    expect(
      updates.some(event => event.type === 'message_update'
        && event.assistantMessageEvent?.type === 'text_delta'
        && String(event.assistantMessageEvent.delta).includes(FIXTURE_MARKERS.answer)),
    ).toBe(true);
    const toolEnds = updates
      .filter(event => event.type === 'tool_execution_end')
      .map(event => [event.toolName, event.isError])
      .sort();
    expect(toolEnds).toEqual([
      ['read', false],
      ['write', false],
    ]);

    const transcript = await connection.request<{
      summary: { title: string; isStreaming: boolean; messageCount: number };
      messages: Array<{ role: string; content: unknown; toolName?: string; isError?: boolean }>;
    }>('session.getMessages', { sessionId, workspaceId });
    expect(transcript.summary.isStreaming).toBe(false);
    expect(transcript.summary.messageCount).toBeGreaterThanOrEqual(5);
    const stableMessageCount = transcript.summary.messageCount;
    expect(transcript.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult', 'toolResult', 'assistant']);
    const final = textOf(transcript.messages.at(-1)?.content);
    expect(final).toContain(FIXTURE_MARKERS.answer);
    expect(final).toContain('# Fixture answer');
    const readResult = transcript.messages.find(message => message.toolName === 'read');
    expect(textOf(readResult?.content)).toContain(FIXTURE_MARKERS.readDone);
    expect(readResult?.isError).toBe(false);
    const writeResult = transcript.messages.find(message => message.toolName === 'write');
    expect(textOf(writeResult?.content).toLowerCase()).toContain('successfully wrote');
    expect(JSON.stringify(transcript.messages.at(-1)?.content)).toContain('"thinking":"Fixture reasoning');

    expect(existsSync(join(fixture.repo, 'fixture-write.md'))).toBe(true);
    expect(readFileSync(join(fixture.repo, 'fixture-write.md'), 'utf8')).toContain(FIXTURE_MARKERS.writeDone);
    expect(readFileSync(join(fixture.repo, 'fixture-read.txt'), 'utf8')).toContain(FIXTURE_MARKERS.readDone);

    const native = readSessionJsonl(fixture.piDir);
    expect(native.lines[0]).toMatchObject({ type: 'session', version: 3, id: sessionId, cwd: fixture.repo });
    const raw = readFileSync(native.path, 'utf8');
    expect(raw).toContain('ASTER_HOST_TOOL_FIXTURE');
    expect(raw).toContain(FIXTURE_MARKERS.readDone);
    expect(raw).toContain(FIXTURE_MARKERS.writeDone);
    expect(raw).toContain(FIXTURE_MARKERS.answer);
    expect(native.lines.some(line => line.type === 'message' && line.message?.role === 'toolResult')).toBe(true);

    const renamedTitle = 'Restart survivor';
    await connection.request('session.rename', { sessionId, workspaceId, title: renamedTitle });
    const afterRenameJsonl = readSessionJsonl(fixture.piDir);
    expect(afterRenameJsonl.lines.at(-1)).toMatchObject({ type: 'session_info', name: renamedTitle });
    const renamedMessages = await connection.request<{ summary: { title: string } }>('session.getMessages', { sessionId, workspaceId });
    expect(renamedMessages.summary.title).toBe(renamedTitle);
    const listed = await connection.request<Array<{ sessionId: string; title: string; messageCount: number }>>(
      'session.list',
      { workspaceId },
    );
    const summary = listed.find(item => item.sessionId === sessionId);
    expect(summary).toMatchObject({ title: renamedTitle, messageCount: stableMessageCount });

    expect(expectNoSqlite(fixture.root)).toEqual([]);
    const isolatedAuth = join(fixture.piDir, 'auth.json');
    if (existsSync(isolatedAuth)) {
      expect(readFileSync(isolatedAuth, 'utf8').trim()).toMatch(/^\{\s*\}$/);
    }
    expect(existsSync(join(fixture.dataDir, 'projects.json'))).toBe(true);
    expect(fixture.provider.requests).toHaveLength(2);
    expect(fixture.provider.requests.every(request => request.model === 'fixture-model')).toBe(true);

    connection.close();
    connection = undefined;
    await host.stop();
    expect(host.child.exitCode).toBe(0);
    host = undefined;
    await expect(fetch(`http://127.0.0.1:${firstPort}/health`)).rejects.toThrow();

    host = await startHost(fixture.env);
    connection = await HostConnection.connect(host.port);
    await connection.waitFor(frame => frame.channel === 'server.welcome', 15_000);
    const projects = await connection.request<Array<{ id: string; path: string }>>('project.list', {});
    expect(projects.some(item => item.id === project.id && realpathSync(item.path) === realpathSync(fixture.repo))).toBe(true);
    const reopenedWorkspaces = await connection.request<Array<{ id: string; kind?: string }>>('workspace.list', { projectId: project.id });
    expect(reopenedWorkspaces.some(item => item.id === workspaceId && item.kind === 'default')).toBe(true);
    const reopened = await connection.request<Array<{ sessionId: string; title: string; messageCount: number }>>(
      'session.list',
      { workspaceId },
    );
    expect(reopened.find(item => item.sessionId === sessionId)).toMatchObject({ title: renamedTitle, messageCount: stableMessageCount });
    const reopenedMessages = await connection.request<{ messages: Array<{ role: string; content: unknown }> }>(
      'session.getMessages',
      { sessionId, workspaceId },
    );
    expect(reopenedMessages.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult', 'toolResult', 'assistant']);
    expect(textOf(reopenedMessages.messages.at(-1)?.content)).toContain(FIXTURE_MARKERS.answer);

    expect(readSessionJsonl(fixture.piDir).lines.at(-1)).toMatchObject({ type: 'session_info', name: renamedTitle });
    expect(expectNoSqlite(fixture.root)).toEqual([]);
    expect(fixture.provider.requests).toHaveLength(2);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await finishHostTest({ connection, host, fixture }, failure);
  }
}, 240_000);
