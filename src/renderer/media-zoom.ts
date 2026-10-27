/*
 * Adapted from Caho1/open-claude-ui, code-examples/MediaLightboxViewer.tsx, MIT,
 * commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * Affine pan and zoom anchored on the pointer, clamped to the overflow of the
 * fitted image box so the frame never wanders off into empty space.
 */

export interface ZoomTransform {
  /** Committed offset, always inside the current scale's bounds. */
  tx: number;
  ty: number;
  /** Unclamped offset, so shrinking and growing again restores the framing. */
  idealTx: number;
  idealTy: number;
  scale: number;
  maxTx: number;
  maxTy: number;
}

/** The reference never zooms below 2x or past the image's natural resolution. */
export const MIN_MAX_SCALE = 2;
/** Pointer travel under this many pixels is a click, not a drag. */
export const DRAG_DEADZONE = 4;
/** Wheel delta is exponentiated so trackpads and notched wheels feel alike. */
export const WHEEL_SENSITIVITY = 0.01;
/** Below this scale the viewer snaps back to fit instead of holding a sliver of zoom. */
export const SNAP_MIN_SCALE = 1.05;

export const FIT_TRANSFORM: ZoomTransform = {
  tx: 0, ty: 0, idealTx: 0, idealTy: 0, scale: 1, maxTx: 0, maxTy: 0,
};

export interface FitBox {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  maxScale: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function clampOffset(value: number, max: number): number {
  return Math.min(max, Math.max(-max, value));
}

/** Translation unlocks gradually so a barely-zoomed image can still be nudged. */
export function maxTranslate(size: number, viewport: number, scale: number): number {
  const factor = Math.min(1, Math.max(0, (scale - SNAP_MIN_SCALE) / 0.95));
  return Math.max(0, (size * scale - viewport) / 2) * factor;
}

export function zoomAt(fit: FitBox, current: ZoomTransform, scale: number, pointer?: { clientX: number; clientY: number } | null): ZoomTransform {
  const maxTx = maxTranslate(fit.width, fit.viewportWidth, scale);
  const maxTy = maxTranslate(fit.height, fit.viewportHeight, scale);
  const offsetX = pointer ? pointer.clientX - fit.centerX : 0;
  const offsetY = pointer ? pointer.clientY - fit.centerY : 0;
  const ratio = scale / current.scale;
  const idealTx = offsetX - (offsetX - current.idealTx) * ratio;
  const idealTy = offsetY - (offsetY - current.idealTy) * ratio;
  return {
    scale,
    tx: clampOffset(idealTx, maxTx),
    ty: clampOffset(idealTy, maxTy),
    // Shrinking bounds commit the framing; growing keeps the free position.
    idealTx: maxTx < current.maxTx ? clampOffset(idealTx, maxTx) : idealTx,
    idealTy: maxTy < current.maxTy ? clampOffset(idealTy, maxTy) : idealTy,
    maxTx,
    maxTy,
  };
}

export function panTo(current: ZoomTransform, tx: number, ty: number): ZoomTransform {
  const nextTx = clampOffset(tx, current.maxTx);
  const nextTy = clampOffset(ty, current.maxTy);
  return { ...current, tx: nextTx, ty: nextTy, idealTx: nextTx, idealTy: nextTy };
}

/** Measurement reads live layout; the arithmetic above stays testable without a DOM. */
export function fitBox(image: HTMLImageElement, viewport: HTMLElement): FitBox | null {
  const imageRect = image.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height || !viewportRect.width || !viewportRect.height) return null;
  return {
    width: imageRect.width,
    height: imageRect.height,
    centerX: imageRect.left + imageRect.width / 2,
    centerY: imageRect.top + imageRect.height / 2,
    maxScale: Math.max(image.naturalWidth / imageRect.width, MIN_MAX_SCALE),
    viewportWidth: viewportRect.width,
    viewportHeight: viewportRect.height,
  };
}
