import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ThinkingLevel } from '@thinkrail/contracts';
import { EffortSelector, effortLevelLabel } from '../../src/renderer/cds/EffortSelector';
import { EFFORT_LEVELS, effortAtPosition, effortTrack, nextSupportedEffort } from '../../src/renderer/cds/effort-slider';

const noop = () => undefined;

function render(levels: ThinkingLevel[], value: ThinkingLevel, disabled = false) {
  return renderToStaticMarkup(<EffortSelector levels={levels} value={value} disabled={disabled} onChange={noop} />);
}

describe('EffortSelector', () => {
  test('puts every reported level on one track, including Off and Minimal', () => {
    const html = render(['off', 'minimal', 'low', 'medium', 'high'], 'medium');

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuetext="Medium"');
    expect(html.match(/data-effort-level=/g)).toHaveLength(5);
    expect(html).toContain('class="effort-tick is-on"');
    /** No extra row of level buttons or labels below the track. */
    expect(html).not.toContain('effort-additional');
    expect(html).not.toContain('effort-labels');
    expect(effortLevelLabel('xhigh')).toBe('Extra');
  });

  test('marks the current level in the header and on every reached tick', () => {
    const html = render(['low', 'high'], 'high');
    const ticks = html.match(/class="effort-tick[^"]*"/g) ?? [];

    expect(ticks).toHaveLength(2);
    expect(ticks.every(tick => tick.includes('is-on'))).toBe(true);
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('class="effort-current" data-off="false">High</span>');
  });

  test('keeps the disabled control focusable and guarded', () => {
    const html = render(['low', 'high'], 'low', true);

    expect(html).toMatch(/tabindex="0"/i);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain(' disabled=""');
  });

  test('shows a single tick and fills the track when the model reports one level', () => {
    const html = render(['high'], 'high');

    expect(html.match(/data-effort-level=/g)).toHaveLength(1);
    expect(html).toContain('aria-valuemax="0"');
    expect(html).toContain('calc(14px + 1 * (100% - 28px))');
  });
});

describe('effort track', () => {
  test('keeps product order and appends a current level the model no longer reports', () => {
    expect(EFFORT_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortTrack(['high', 'low'], 'low')).toEqual(['low', 'high']);
    expect(effortTrack(['low'], 'max')).toEqual(['low', 'max']);
    expect(effortTrack([], 'high')).toEqual([]);
  });

  test('maps a pointer position onto the level actually under it', () => {
    const track: ThinkingLevel[] = ['low', 'medium', 'high'];

    expect(effortAtPosition(track, 0)).toBe('low');
    expect(effortAtPosition(track, .5)).toBe('medium');
    expect(effortAtPosition(track, .75)).toBe('high');
    expect(effortAtPosition(track, 1)).toBe('high');
    expect(effortAtPosition(track, Number.NaN)).toBeNull();
    expect(effortAtPosition([], 0)).toBeNull();
  });

  test('keyboard steps through reported levels only', () => {
    const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'high', 'max'];
    const track = effortTrack(levels, 'low');

    expect(nextSupportedEffort(track, levels, 'low', 'ArrowRight')).toBe('high');
    expect(nextSupportedEffort(track, levels, 'max', 'ArrowLeft')).toBe('high');
    expect(nextSupportedEffort(track, levels, 'off', 'ArrowRight')).toBe('minimal');
    expect(nextSupportedEffort(track, levels, 'high', 'Home')).toBe('off');
    expect(nextSupportedEffort(track, levels, 'high', 'End')).toBe('max');
    expect(nextSupportedEffort(['high'], ['high'], 'high', 'ArrowRight')).toBeNull();
  });
});
