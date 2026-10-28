/*
 * Adapted from Caho1/open-claude-ui (ModelSelectorEffort) and the Codex-style
 * track in Microqian2th/dsh-codex-effort-slider (MIT): a menu row plus one
 * full-width pill track with ticks, a 28px knob and a level-coloured fill.
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ThinkingLevel } from '@thinkrail/contracts';
import { effortAtPosition, effortTrack, nextSupportedEffort, type EffortSliderKey } from './effort-slider';
import './effort-selector.css';

const LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
};
const SLIDER_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const KNOB_RADIUS = 14;

/** Knob and ticks use the same offset so a tick always sits under the knob. */
function offsetOf(fraction: number): string {
  return 'calc(' + KNOB_RADIUS + 'px + ' + Math.max(0, Math.min(1, fraction)) + ' * (100% - ' + KNOB_RADIUS * 2 + 'px))';
}

export function effortLevelLabel(level: ThinkingLevel): string {
  return LEVEL_LABELS[level];
}

export function EffortSelector({ levels, value, onChange, disabled = false }: {
  levels: readonly ThinkingLevel[];
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  disabled?: boolean;
}) {
  const slider = useRef<HTMLDivElement | null>(null);
  const activePointer = useRef<number | null>(null);
  const [preview, setPreview] = useState<ThinkingLevel | null>(null);
  const hintId = useId();
  const track = effortTrack(levels, value);
  const shown = preview ?? value;
  const shownIndex = track.indexOf(shown);
  const lastIndex = track.length > 1 ? track.length - 1 : 0;
  /** A single reported level is the maximum, so it fills the track. */
  const fraction = track.length === 0 ? 0 : track.length === 1 ? 1 : Math.max(0, shownIndex) / lastIndex;
  const sliderDisabled = disabled || levels.length === 0;

  function pick(event: PointerEvent<HTMLDivElement>): ThinkingLevel | null {
    const rect = event.currentTarget.getBoundingClientRect();
    const usable = rect.width - KNOB_RADIUS * 2;
    if (!(usable > 0)) return null;
    return effortAtPosition(track, (event.clientX - rect.left - KNOB_RADIUS) / usable);
  }
  function commit(next: ThinkingLevel | null) {
    setPreview(null);
    if (!next || disabled || !levels.includes(next) || next === value) return;
    onChange(next);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (sliderDisabled || !SLIDER_KEYS.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = nextSupportedEffort(track, levels, value, event.key as EffortSliderKey);
    if (next) onChange(next);
  }

  return <div className="effort-inline" data-cds="ModelSelectorEffort">
    <div className="effort-head">
      <span className="effort-current" data-off={shown === 'off'}>{effortLevelLabel(shown)}</span>
    </div>
    <div
      className={'effort-track' + (sliderDisabled ? ' is-disabled' : '') + (preview ? ' is-live' : '')}
      role="slider"
      ref={slider}
      tabIndex={0}
      aria-label="Thinking effort"
      aria-describedby={hintId}
      aria-disabled={sliderDisabled}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, track.length - 1)}
      aria-valuenow={shownIndex < 0 ? 0 : shownIndex}
      aria-valuetext={effortLevelLabel(shown)}
      onKeyDown={keyDown}
      onPointerDown={event => {
        if (sliderDisabled || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setPreview(pick(event));
      }}
      onPointerMove={event => {
        if (sliderDisabled || activePointer.current !== event.pointerId) return;
        setPreview(pick(event));
      }}
      onPointerUp={event => {
        if (activePointer.current !== event.pointerId) return;
        activePointer.current = null;
        commit(pick(event));
      }}
      onPointerCancel={event => {
        if (activePointer.current !== event.pointerId) return;
        activePointer.current = null;
        setPreview(null);
      }}
    >
      <span className="effort-track-fill" aria-hidden="true" style={{ width: offsetOf(fraction) }} />
      {track.map((level, index) => <span
        key={level}
        data-effort-level={level}
        className={'effort-tick' + (shownIndex >= index ? ' is-on' : '')}
        style={{ left: offsetOf(track.length > 1 ? index / lastIndex : 1) }}
        aria-hidden="true"
      />)}
      <span className="effort-knob" aria-hidden="true" style={{ left: offsetOf(fraction) }} />
    </div>
    <p id={hintId} className="effort-sr-only">
      {track.length > 0 ? 'Available levels: ' + track.map(effortLevelLabel).join(', ') + '. Use arrow keys, Home or End to choose.' : 'No thinking levels are available for this model.'}
    </p>
  </div>;
}
