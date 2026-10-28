import { describe, expect, it } from 'vitest';
import { CARDS_COLUMN_WIDTH, cardsFitInline, clampRatio, overlayPreviewWidth, previewCanSplit, previewWidth, ratioBounds, splitMinLeftWidth } from '../../src/renderer/layout-metrics';

describe('workspace layout metrics', () => {
  it('splits the preview whenever the conversation and preview keep their minimum', () => {
    expect(previewCanSplit(808)).toBe(true);
    expect(previewCanSplit(807)).toBe(false);
    expect(previewCanSplit(1112)).toBe(true);
  });

  it('docks the cards only while the conversation keeps its minimum beside them', () => {
    expect(cardsFitInline(1112, true)).toBe(true);
    expect(cardsFitInline(1111, true)).toBe(false);
    expect(cardsFitInline(684, false)).toBe(true);
    expect(cardsFitInline(683, false)).toBe(false);
  });

  it('adds the card column to the left minimum only while cards are docked', () => {
    expect(splitMinLeftWidth(false)).toBe(380);
    expect(splitMinLeftWidth(true)).toBe(380 + CARDS_COLUMN_WIDTH);
  });

  it('clamps a ratio between both pane minimums', () => {
    const bounds = ratioBounds(1280, true);
    expect(bounds).not.toBeNull();
    expect(clampRatio(0.05, 1280, true)).toBeCloseTo(bounds!.min, 5);
    expect(clampRatio(0.95, 1280, true)).toBeCloseTo(bounds!.max, 5);
    expect(clampRatio(0.5, 1280, true)).toBeCloseTo(bounds!.min, 5);
  });

  it('keeps a stored ratio untouched when the split is not available', () => {
    expect(clampRatio(0.5, 600, false)).toBe(0.5);
    expect(ratioBounds(600, false)).toBeNull();
  });

  it('measures the preview pane from the same bounds', () => {
    expect(previewWidth(1280, 0.5, false)).toBeCloseTo(636, 5);
    expect(previewWidth(1280, 0.95, false)).toBeCloseTo(420, 5);
    expect(previewWidth(1280, 0.05, false)).toBeCloseTo(892, 5);
    expect(previewWidth(1280, 0.5, true)).toBeCloseTo(588, 5);
  });

  it('caps the narrow overlay preview without exceeding the workspace', () => {
    expect(overlayPreviewWidth(1600)).toBe(600);
    expect(overlayPreviewWidth(500)).toBe(476);
    expect(overlayPreviewWidth(200)).toBe(280);
  });
});
