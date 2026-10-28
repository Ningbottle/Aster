import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, CheckCircle, Circle, CircleNotch, ListChecks } from '@phosphor-icons/react';
import { WS_CHANNELS, type SessionEventPayload, type TodoItem, type TodoPlan, type TodoStatus } from '@thinkrail/contracts';
import type { ConnectionStatus, WsClient } from './client';
import './todo.css';

type DisplaySection = { id: string; title?: string; items: TodoItem[]; readOnly?: boolean };

/** Only real todos belong in the list; adopted commits are git history, not tasks. */
export function todoSections(plan: TodoPlan): DisplaySection[] {
  const sections: DisplaySection[] = plan.groups.filter(group => group.todos.length > 0).map(group => ({ id: group.id, title: group.title, items: group.todos }));
  if (plan.todos.length) sections.push({ id: 'ungrouped', items: plan.todos });
  return sections;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyUpdatedItem(plan: TodoPlan, updated: TodoItem): TodoPlan {
  const update = (item: TodoItem) => item.id === updated.id ? updated : item;
  return {
    ...plan,
    todos: plan.todos.map(update),
    groups: plan.groups.map(group => ({ ...group, todos: group.todos.map(update) })),
  };
}

function statusName(status: TodoStatus): string {
  if (status === 'done') return 'Done';
  if (status === 'in_progress') return 'In progress';
  return 'Pending';
}

type TodoViewState = {
  workspaceId: string;
  sessionId: string;
  plan: TodoPlan | null;
  loading: boolean;
  error: string | null;
  pendingId: string | null;
};

function emptyViewState(workspaceId: string, sessionId: string): TodoViewState {
  return { workspaceId, sessionId, plan: null, loading: false, error: null, pendingId: null };
}

function stateMatches(state: TodoViewState, workspaceId: string, sessionId: string): boolean {
  return state.workspaceId === workspaceId && state.sessionId === sessionId;
}

export function TodoRows({ plan, pendingId, disabled = false, onToggle }: {
  plan: TodoPlan;
  pendingId?: string | null;
  disabled?: boolean;
  onToggle?: (item: TodoItem) => void;
}) {
  const sections = todoSections(plan);
  return <div className="todo-sections">
    {sections.map(section => <section className="todo-group" key={section.id} aria-label={section.title}>
      {section.title && <h3 className="todo-group-title">{section.title}</h3>}
      <ul className="todo-list">
        {section.items.map(item => {
          const pending = pendingId === item.id;
          const canToggle = !section.readOnly && item.origin !== 'adopted' && Boolean(onToggle);
          const StateIcon = item.status === 'done' ? CheckCircle : item.status === 'in_progress' ? CircleNotch : Circle;
          return <li className={`todo-row todo-${item.status}`} key={item.id}>
            {canToggle
              ? <button type="button" className="todo-check" role="checkbox" aria-checked={item.status === 'done'} aria-label={`${item.title}: ${statusName(item.status)}`} disabled={disabled || pending} onClick={() => onToggle?.(item)}>
                {pending ? <CircleNotch className="todo-pending-icon" size={16} aria-hidden="true" /> : <StateIcon className={item.status === 'in_progress' ? 'spin' : undefined} size={16} weight={item.status === 'done' ? 'fill' : 'regular'} aria-hidden="true" />}
              </button>
              : <span className="todo-status-icon" aria-hidden="true"><StateIcon size={16} weight={item.status === 'done' ? 'fill' : 'regular'} /></span>}
            <span className="todo-title">{item.title}</span>
            <span className="todo-status" aria-label={`Status: ${statusName(item.status)}`}>{statusName(item.status)}</span>
          </li>;
        })}
      </ul>
    </section>)}
  </div>;
}

export function TodoSection({ client, workspaceId, sessionId, connection }: {
  client: WsClient;
  workspaceId: string;
  sessionId: string;
  connection: ConnectionStatus;
}) {
  const [state, setState] = useState(() => emptyViewState(workspaceId, sessionId));
  const [expanded, setExpanded] = useState(true);
  const loadVersion = useRef(0);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    const load = async () => {
      const requestId = ++loadVersion.current;
      setState(previous => {
        const current = stateMatches(previous, workspaceId, sessionId) ? previous : emptyViewState(workspaceId, sessionId);
        return { ...current, loading: true, error: null };
      });
      try {
        const plan = await client.request('todo.list', { workspaceId, sessionId });
        if (!active || requestId !== loadVersion.current) return;
        setState(previous => stateMatches(previous, workspaceId, sessionId)
          ? { ...previous, plan, loading: false, error: null }
          : previous);
      } catch (cause) {
        if (!active || requestId !== loadVersion.current) return;
        setState(previous => stateMatches(previous, workspaceId, sessionId)
          ? { ...previous, loading: false, error: errorText(cause) }
          : previous);
      }
    };
    refreshRef.current = () => { if (connection === 'connected') void load(); };
    const unsubscribe = client.subscribe(WS_CHANNELS.piEvent, data => {
      const push = data as SessionEventPayload;
      if (push?.sessionId !== sessionId) return;
      if (push.event?.type === 'agent_settled' || push.event?.type === 'tool_execution_end') void load();
    });
    if (connection === 'connected') void load();
    else setState(previous => {
      if (!stateMatches(previous, workspaceId, sessionId)) return emptyViewState(workspaceId, sessionId);
      return previous.loading
        ? { ...previous, loading: false, error: 'Disconnected from the local server.' }
        : previous;
    });
    return () => {
      active = false;
      loadVersion.current += 1;
      unsubscribe();
      refreshRef.current = () => {};
    };
  }, [client, workspaceId, sessionId, connection]);

  const current = stateMatches(state, workspaceId, sessionId) ? state : null;
  const plan = current?.plan ?? null;
  const hasItems = Boolean(plan && todoSections(plan).some(section => section.items.length));
  if (!current || (!plan && !current.error)) return null;
  if (plan && !hasItems && !current.error) return null;
  const toggle = async (item: TodoItem) => {
    if (!plan || current.pendingId || connection !== 'connected') return;
    const nextStatus: TodoStatus = item.status === 'done' ? 'pending' : 'done';
    setState(previous => stateMatches(previous, workspaceId, sessionId) && !previous.pendingId
      ? { ...previous, pendingId: item.id, error: null }
      : previous);
    try {
      const updated = await client.request('todo.update', { workspaceId, sessionId, id: item.id, status: nextStatus }, { sessionId });
      loadVersion.current += 1;
      setState(previous => {
        if (!stateMatches(previous, workspaceId, sessionId) || previous.pendingId !== item.id || !previous.plan) return previous;
        return { ...previous, plan: applyUpdatedItem(previous.plan, updated), loading: false, error: null, pendingId: null };
      });
    } catch (cause) {
      setState(previous => stateMatches(previous, workspaceId, sessionId) && previous.pendingId === item.id
        ? { ...previous, pendingId: null, error: `Could not update “${item.title}”: ${errorText(cause)}` }
        : previous);
    }
  };

  return <details className="info-card todo-card" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>
      <ListChecks size={13} aria-hidden="true" />
      <span>Todos</span>
      {plan && <span className="todo-count">{todoSections(plan).flatMap(section => section.items).filter(item => item.status !== 'done').length} open</span>}
      <button className="todo-refresh" type="button" aria-label="Refresh todos" title="Refresh todos" disabled={current.loading || connection !== 'connected'} onClick={event => { event.preventDefault(); event.stopPropagation(); refreshRef.current(); }}>
        <ArrowClockwise size={13} aria-hidden="true" />
      </button>
    </summary>
    {current.loading && plan && <p className="todo-message" role="status">Refreshing todos…</p>}
    {current.error && <div className="todo-error" role="alert"><span>{current.error}</span><button type="button" disabled={connection !== 'connected' || current.loading} onClick={() => refreshRef.current()}>Retry</button></div>}
    {plan && hasItems && <TodoRows plan={plan} pendingId={current.pendingId} disabled={current.pendingId !== null || connection !== 'connected'} onToggle={toggle} />}
  </details>;
}
