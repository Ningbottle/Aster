import { useEffect, useState } from 'react';
import { WS_CHANNELS, type SessionEventPayload, type UsageRange, type UsageSummary } from '@thinkrail/contracts';
import type { ConnectionStatus, WsClient } from './client';
import { UsageDashboard } from './UsageDashboard';

/** The new-session homepage owns this view; history is read without attaching sessions. */
export function HomeUsage({ client, connection, booting }: { client: WsClient; connection: ConnectionStatus; booting: boolean }) {
  const [range, setRange] = useState<UsageRange>('all');
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let active = true;
    setSummary(null);
    setError(null);
    setLoading(true);
    if (booting || connection !== 'connected') {
      if (!booting && connection === 'disconnected') {
        setError('Disconnected from the local server. Reconnect to read usage.');
        setLoading(false);
      }
      return;
    }
    void client.request('usage.getSummary', { range, timeZone }).then(result => {
      if (active) { setSummary(result); setLoading(false); }
    }, cause => {
      if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); }
    });
    return () => { active = false; };
  }, [client, connection, booting, range, revision, timeZone]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const unsubscribers = [client.subscribe(WS_CHANNELS.piEvent, data => {
      const { event } = data as SessionEventPayload;
      if (event.type === 'agent_settled' || event.type === 'compaction_end') refresh();
    }), ...[WS_CHANNELS.sessionDeleted, WS_CHANNELS.workspaceRemoved, WS_CHANNELS.workspaceCreated].map(channel => client.subscribe(channel, refresh))];
    return () => { for (const unsubscribe of unsubscribers) unsubscribe(); };
  }, [client]);

  return <UsageDashboard summary={summary} range={range} onRangeChange={setRange} loading={loading} error={error} onRefresh={() => setRevision(value => value + 1)} />;
}
