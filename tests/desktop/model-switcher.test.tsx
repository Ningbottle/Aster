import { describe, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WireModel } from '@thinkrail/contracts';
import { ModelSwitcher } from '../../src/renderer/cds/ModelSwitcher';

function model(provider: string, id: string, name: string): WireModel {
  return { provider, id, name, contextWindow: 128_000, reasoning: true, thinkingLevels: ['low', 'high'] };
}

const first = model('fixture-a', 'same-id', 'First model');
const second = model('fixture-b', 'same-id', 'Second model');

describe('ModelSwitcher', () => {
  test('opens on the current model row and the effort control, not a flat list', () => {
    const html = renderToStaticMarkup(<ModelSwitcher models={[first, second]} currentModel={second} effort="xhigh" open
      onOpenChange={vi.fn()} onChooseModel={vi.fn()}><span>Effort footer</span></ModelSwitcher>);
    expect(html).toContain('data-cds="ModelSwitcher"');
    expect(html).toContain('aria-label="Model: Second model, effort: Extra"');
    expect(html).toContain('role="menu" aria-label="Model"');
    expect(html).toContain('class="model-switcher-current"');
    expect(html).toContain('Second model');
    expect(html).toContain('Effort footer');
    /** The list belongs behind the model row, not under the effort track. */
    expect(html).not.toContain('model-switcher-options');
    expect(html).not.toContain('Recommended');
    expect(html).not.toContain('Default');
  });

  test('without an effort control the model list is shown directly', () => {
    const html = renderToStaticMarkup(<ModelSwitcher models={[first]} currentModel={null} effort="off" disabled open
      onOpenChange={vi.fn()} onChooseModel={vi.fn()} />);
    expect(html).toContain('aria-label="Model: No model, effort: Off"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain(' disabled=""');
    expect(html).toContain('model-switcher-options');
    expect(html).not.toContain('model-switcher-list-head');
    expect(html).not.toContain('aria-checked="true"');
  });

  test('an empty model list is a status row, not an empty picker', () => {
    const html = renderToStaticMarkup(<ModelSwitcher models={[]} currentModel={null} effort="medium" open
      onOpenChange={vi.fn()} onChooseModel={vi.fn()}><span>Effort footer</span></ModelSwitcher>);
    expect(html).toContain('model-switcher-status');
    expect(html).toContain('No model configured');
    expect(html).toContain('Effort footer');
    expect(html).not.toContain('model-switcher-current');
    expect(html).not.toContain('model-switcher-options');
  });

  test('with neither models nor effort the trigger cannot open', () => {
    const html = renderToStaticMarkup(<ModelSwitcher models={[]} currentModel={null} effort="medium" open={false}
      onOpenChange={vi.fn()} onChooseModel={vi.fn()} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('role="menu"');
  });
});
