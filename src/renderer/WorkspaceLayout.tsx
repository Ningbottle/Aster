import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CARDS_COLUMN_WIDTH, cardsFitInline, overlayPreviewWidth, previewCanSplit, SPLIT_HANDLE_WIDTH } from './layout-metrics';
import { SplitPane } from './cds/SplitPane';

/**
 * Owns the three-part workspace geometry: conversation, fixed information cards
 * and the resizable preview. Layout only; it never decides which file is open or
 * whether the cards are expanded beyond the two boolean inputs.
 */
export function WorkspaceLayout({ stage, cards, preview, cardsOpen, previewOpen, foreground, ratio, onRatioChange, onRatioCommit, onCloseOverlay }: {
  /** Renders the conversation surface; the docked cards join its own scroll viewport. */
  stage: (cards: ReactNode) => ReactNode;
  cards: ReactNode;
  preview: ReactNode;
  cardsOpen: boolean;
  previewOpen: boolean;
  /** Which of the two survives when a narrow workspace can only show one layer. */
  foreground: 'cards' | 'preview';
  ratio: number;
  onRatioChange: (ratio: number) => void;
  /** Fired once per settled resize, so the ratio can be stored without per-frame writes. */
  onRatioCommit: (ratio: number) => void;
  onCloseOverlay: (layer: 'cards' | 'preview') => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** Height of the docked composer; overlays stop above it so it stays usable. */
  const [composerSpace, setComposerSpace] = useState(0);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const composer = element.querySelector<HTMLElement>('.composer-slot');
      const next = composer ? Math.round(composer.getBoundingClientRect().height) : 0;
      setComposerSpace(current => current === next ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const composer = element.querySelector<HTMLElement>('.composer-slot');
    if (composer) observer.observe(composer);
    return () => observer.disconnect();
  }, [cardsOpen, previewOpen]);

  /** Until the row is measured, assume the widest arrangement to avoid an overlay flash. */
  const measured = width > 0;
  /** Without a preview there is nothing to split; the cards stay a fixed column. */
  const split = previewOpen && (!measured || previewCanSplit(width));
  /** Cards dock beside the conversation only while both keep their minimum width. */
  const cardsInline = cardsOpen && (!measured || cardsFitInline(width, previewOpen));
  const previewOverlay = previewOpen && !split && (foreground === 'preview' || !cardsOpen);
  /** A split preview keeps the cards floating beside the divider; without a preview the cards still own the narrow layer. */
  const cardsOverlay = cardsOpen && !cardsInline && (split || !previewOpen || foreground === 'cards');
  const topLayer: 'cards' | 'preview' | null = cardsOverlay ? 'cards' : previewOverlay ? 'preview' : null;
  /** Floating cards stop at the left pane's edge, so the split preview stays readable. */
  const cardsOverlayRight = split
    ? `calc((100% - ${SPLIT_HANDLE_WIDTH}px) * ${1 - ratio} + ${SPLIT_HANDLE_WIDTH + 12}px)`
    : 12;

  /** Escape closes the foreground overlay only while focus is inside it. */
  useEffect(() => {
    if (!topLayer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      const active = document.activeElement;
      const layer = document.querySelector<HTMLElement>(`[data-workspace-overlay="${topLayer}"]`);
      if (!layer || !(active instanceof Node) || !layer.contains(active)) return;
      event.preventDefault();
      onCloseOverlay(topLayer);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCloseOverlay, topLayer]);

  const stagePane = <div className="workspace-stage">{stage(cardsInline ? cards : null)}</div>;

  return <div className="workspace-row" ref={row}>
    {previewOpen && split
      ? <SplitPane
        label="Resize the file preview; double-click for 50/50, arrow keys to adjust and Escape to undo"
        cardsInline={cardsInline}
        ratio={ratio}
        onRatioChange={onRatioChange}
        onRatioCommit={onRatioCommit}
        leftPane={stagePane}
        rightPane={preview}
      />
      : stagePane}
    {/* A narrow workspace shows one foreground layer; the preview keeps its selection
        and width, so closing the cards returns to the same file. */}
    {previewOverlay && <div className="workspace-overlay is-preview" data-workspace-overlay="preview"
      style={{ right: 12, bottom: composerSpace + 8, width: overlayPreviewWidth(width) }}>
      {preview}
    </div>}
    {cardsOverlay && <div className="workspace-overlay is-cards" data-workspace-overlay="cards"
      style={{ right: cardsOverlayRight, bottom: composerSpace + 8, width: CARDS_COLUMN_WIDTH }}>
      {cards}
    </div>}
  </div>;
}
