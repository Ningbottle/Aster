import type { SessionSummary, WsResult } from '@thinkrail/contracts';
import type { WsClient } from './client';

interface SessionContentCallbacks {
  transcript(result: WsResult<'session.getMessages'>): void;
  commands(result: WsResult<'session.getCommands'>): void;
  stats(result: WsResult<'session.getStats'>): void;
  failed(section: 'commands' | 'stats', cause: unknown): void;
}

/** The transcript attaches Pi first. Auxiliary data must not hold the conversation open. */
export async function loadSessionContent(
  client: Pick<WsClient, 'request'>,
  selection: Pick<SessionSummary, 'workspaceId' | 'sessionId'>,
  receive: SessionContentCallbacks,
): Promise<void> {
  const result = await client.request('session.getMessages', selection);
  receive.transcript(result);
  void client.request('session.getCommands', { sessionId: selection.sessionId })
    .then(receive.commands)
    .catch(cause => receive.failed('commands', cause));
  void client.request('session.getStats', { sessionId: selection.sessionId })
    .then(receive.stats)
    .catch(cause => receive.failed('stats', cause));
}
