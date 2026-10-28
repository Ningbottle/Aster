/**
 * Pure geometry for the workspace layout. The conversation, the fixed information
 * cards and the resizable preview are three independent regions; only the preview
 * takes part in the drag split.
 *
 * Three presentation bands, from the widest to the narrowest:
 * - wide: conversation + docked cards + split preview;
 * - medium: conversation + split preview, cards float beside the divider;
 * - narrow: a single foreground layer (preview, or the cards opened over it).
 */

/** Fixed information-card column: 280px card plus 12px padding on both sides. */
export const CARDS_COLUMN_WIDTH = 304;
export const SPLIT_MIN_CONVERSATION = 380;
export const SPLIT_MIN_PREVIEW = 420;
export const SPLIT_HANDLE_WIDTH = 8;
/** Conversation and preview can share the row even while the cards float. */
export const SPLIT_MIN_WIDTH = SPLIT_MIN_CONVERSATION + SPLIT_MIN_PREVIEW + SPLIT_HANDLE_WIDTH;
/** Everything fits side by side once the card column joins the split. */
export const WIDE_MIN_WIDTH = SPLIT_MIN_WIDTH + CARDS_COLUMN_WIDTH;
const OVERLAY_MAX_PREVIEW = 600;
const OVERLAY_GUTTER = 24;

export interface RatioBounds {
  min: number;
  max: number;
}

/** Width available to the two draggable panes; the separator is not part of either. */
function paneWidth(width: number): number {
  return Math.max(0, width - SPLIT_HANDLE_WIDTH);
}

/** The left pane must still fit the conversation and any docked card column. */
export function splitMinLeftWidth(cardsInline: boolean): number {
  return SPLIT_MIN_CONVERSATION + (cardsInline ? CARDS_COLUMN_WIDTH : 0);
}

/** A split preview is offered whenever both draggable panes keep their minimum. */
export function previewCanSplit(width: number): boolean {
  return width >= SPLIT_MIN_WIDTH;
}

/** Cards dock only while the conversation keeps its minimum next to them. */
export function cardsFitInline(width: number, previewOpen: boolean): boolean {
  return width >= (previewOpen ? WIDE_MIN_WIDTH : splitMinLeftWidth(true));
}

export function ratioBounds(width: number, cardsInline: boolean): RatioBounds | null {
  const panes = paneWidth(width);
  if (panes <= 0) return null;
  const min = splitMinLeftWidth(cardsInline) / panes;
  const max = (panes - SPLIT_MIN_PREVIEW) / panes;
  return min <= max ? { min, max } : null;
}

/** Keeps a requested ratio usable after window resizes and card toggles. */
export function clampRatio(ratio: number, width: number, cardsInline: boolean): number {
  const bounds = ratioBounds(width, cardsInline);
  if (!bounds) return ratio;
  return Math.min(bounds.max, Math.max(bounds.min, ratio));
}

/** Narrow layouts show the preview above the conversation instead of squeezing it. */
export function overlayPreviewWidth(width: number): number {
  return Math.max(280, Math.min(OVERLAY_MAX_PREVIEW, width - OVERLAY_GUTTER));
}

/** The preview pane's measured width for a ratio, clamped by the same bounds. */
export function previewWidth(width: number, ratio: number, cardsInline: boolean): number {
  const panes = paneWidth(width);
  const clamped = clampRatio(ratio, width, cardsInline);
  return Math.max(0, panes - clamped * panes);
}
