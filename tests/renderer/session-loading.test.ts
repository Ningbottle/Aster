import { describe, expect, test, vi } from 'vitest';
import type { WsResult } from '@thinkrail/contracts';
import type { WsClient } from '../../src/renderer/client';
import { loadSessionContent } from '../../src/renderer/session-loading';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const selection = { sessionId: 's1', workspaceId: 'w1' };
const transcript: WsResult<'session.getMessages'> = {
  summary: { ...selection, title: '', model: null, thinkingLevel: 'medium', approvalMode: 'auto', isStreaming: false, messageCount: 0, updatedAt: 1, live: true },
  messages: [],
};

describe('opening session content', () => {
  test('attaches the transcript first, then reads metadata in parallel without holding content open', async () => {
    const messages = deferred<WsResult<'session.getMessages'>>();
    const commands = deferred<WsResult<'session.getCommands'>>();
    const stats = deferred<WsResult<'session.getStats'>>();
    const request = vi.fn((method: string) => ({
      'session.getMessages': messages.promise,
      'session.getCommands': commands.promise,
      'session.getStats': stats.promise,
    })[method]);
    const receive = { transcript: vi.fn(), commands: vi.fn(), stats: vi.fn(), failed: vi.fn() };
    const loading = loadSessionContent({ request } as unknown as Pick<WsClient, 'request'>, selection, receive);
    expect(request.mock.calls.map(([method]) => method)).toEqual(['session.getMessages']);

    messages.resolve(transcript);
    await loading;
    expect(receive.transcript).toHaveBeenCalledWith(transcript);
    expect(request.mock.calls.map(([method]) => method)).toEqual(['session.getMessages', 'session.getCommands', 'session.getStats']);
    expect(receive.commands).not.toHaveBeenCalled();
    expect(receive.stats).not.toHaveBeenCalled();

    commands.reject(new Error('commands unavailable'));
    await vi.waitFor(() => expect(receive.failed).toHaveBeenCalledWith('commands', expect.any(Error)));
    stats.resolve({} as WsResult<'session.getStats'>);
    await vi.waitFor(() => expect(receive.stats).toHaveBeenCalledOnce());
    expect(receive.transcript).toHaveBeenCalledOnce();
  });

  test('an attachment failure stays visible to the caller and does not request live-only metadata', async () => {
    const request = vi.fn().mockRejectedValue(new Error('session unavailable'));
    const receive = { transcript: vi.fn(), commands: vi.fn(), stats: vi.fn(), failed: vi.fn() };
    await expect(loadSessionContent({ request } as unknown as Pick<WsClient, 'request'>, selection, receive)).rejects.toThrow('session unavailable');
    expect(request).toHaveBeenCalledTimes(1);
    expect(receive.transcript).not.toHaveBeenCalled();
  });
});
