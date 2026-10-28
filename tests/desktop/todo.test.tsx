import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TodoItem, TodoPlan } from '@thinkrail/contracts';
import { TodoRows, todoSections } from '../../src/renderer/TodoSection';

function item(id: string, status: TodoItem['status'], origin: TodoItem['origin'] = 'agent'): TodoItem {
  return { id, title: `Task ${id}`, status, origin, createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z' };
}

const plan: TodoPlan = {
  todos: [item('loose', 'pending')],
  groups: [{ id: 'phase', title: 'Phase one', status: 'active', todos: [item('working', 'in_progress'), item('finished', 'done')] }],
  adoptedCommits: [item('adopted', 'done', 'adopted')],
};

describe('TodoSection', () => {
  test('lists native groups and loose todos but never adopted commits', () => {
    // Adopted commits are git history; showing them as tasks made the card read like a changelog.
    expect(todoSections(plan).map(section => [section.id, section.items.map(todo => todo.id), section.readOnly])).toEqual([
      ['phase', ['working', 'finished'], undefined],
      ['ungrouped', ['loose'], undefined],
    ]);
  });

  test('renders status rows accessibly', () => {
    const html = renderToStaticMarkup(<TodoRows plan={plan} onToggle={() => {}} />);
    expect(html).toContain('aria-checked="false" aria-label="Task working: In progress"');
    expect(html).toContain('aria-checked="true" aria-label="Task finished: Done"');
    expect(html).toContain('Status: Pending');
    expect(html).not.toContain('Adopted commits');
    expect(html).not.toContain('Task adopted');
  });
});
