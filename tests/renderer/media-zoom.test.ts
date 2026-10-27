import { describe, expect, it } from 'vitest';
import { FIT_TRANSFORM, clampOffset, maxTranslate, panTo, zoomAt, type FitBox, type ZoomTransform } from '../../src/renderer/media-zoom';

/** A 400×300 image fitted inside an 800×600 viewport, zoomable to 4x. */
const fit: FitBox = { width: 400, height: 300, centerX: 500, centerY: 400, maxScale: 4, viewportWidth: 800, viewportHeight: 600 };

const at = (patch: Partial<ZoomTransform>): ZoomTransform => ({ ...FIT_TRANSFORM, ...patch });

describe('media zoom physics', () => {
  it('clamps offsets symmetrically', () => {
    expect(clampOffset(900, 120)).toBe(120);
    expect(clampOffset(-900, 120)).toBe(-120);
    expect(clampOffset(40, 120)).toBe(40);
  });

  it('unlocks translation only once the image overflows the viewport', () => {
    expect(maxTranslate(400, 800, 1)).toBe(0);
    expect(maxTranslate(400, 800, 2)).toBe(0);
    expect(maxTranslate(400, 800, 4)).toBe(400);
  });

  it('keeps the pointer anchored under its own pixel while zooming', () => {
    const centred = zoomAt(fit, FIT_TRANSFORM, 4, { clientX: 500, clientY: 400 });
    expect(centred.tx).toBe(0);
    expect(centred.ty).toBe(0);

    const right = zoomAt(fit, FIT_TRANSFORM, 4, { clientX: 600, clientY: 400 });
    expect(right.tx).toBe(-300);
    expect(right.ty).toBe(0);

    const far = zoomAt(fit, FIT_TRANSFORM, 4, { clientX: 900, clientY: 400 });
    expect(far.tx).toBe(-400);
  });

  it('scales around the centre when no pointer is given', () => {
    const next = zoomAt(fit, FIT_TRANSFORM, 3);
    expect(next.tx).toBe(0);
    expect(next.ty).toBe(0);
    expect(next.maxTx).toBe(200);
  });

  it('commits the framing when shrinking and keeps it when growing again', () => {
    const zoomed = at({ scale: 4, tx: 400, idealTx: 400, maxTx: 400 });
    const shrunk = zoomAt(fit, zoomed, 2);
    expect(shrunk.maxTx).toBe(0);
    expect(shrunk.tx).toBe(0);
    expect(shrunk.idealTx).toBe(0);

    const restored = at({ scale: 2, idealTx: 200 });
    const grown = zoomAt(fit, restored, 4);
    expect(grown.maxTx).toBe(400);
    expect(grown.tx).toBe(400);
    expect(grown.idealTx).toBe(400);
  });

  it('pans inside the current bounds and records the free position', () => {
    const zoomed = at({ scale: 4, tx: 40, maxTx: 400, maxTy: 0 });
    expect(panTo(zoomed, 900, 50)).toMatchObject({ tx: 400, ty: 0, idealTx: 400, idealTy: 0 });
    expect(panTo(zoomed, -90, 0)).toMatchObject({ tx: -90, ty: 0 });
  });
});
