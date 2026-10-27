import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** Visible, enabled controls in DOM order; the browser still decides radio roving per group. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element =>
    element.tabIndex >= 0
    && !element.matches(':disabled')
    && element.getClientRects().length > 0
    && !element.closest('[inert]'));
}

/** Modal layers in mount order so only the topmost one traps Tab. */
const layers: HTMLElement[] = [];

export interface ModalFocusOptions {
  /** Selector for the control to focus first; falls back to [data-autofocus], then DOM order. */
  initialFocusSelector?: string;
  /** Used when the element focused before opening is no longer available. */
  fallbackFocusSelector?: string;
}

/**
 * Keeps keyboard focus inside a modal, makes the rest of the desktop shell inert,
 * and returns focus to the opener (or fallback) when the layer unmounts.
 */
export function useModalFocus<T extends HTMLElement>(layerRef: RefObject<T | null>, options: ModalFocusOptions = {}): void {
  const { initialFocusSelector, fallbackFocusSelector } = options;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const dialog = layer.querySelector<HTMLElement>('[role="dialog"]') ?? layer;
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const shell = layer.closest('.desktop-shell');
    const inerted: { element: HTMLElement; hadInert: boolean; ariaHidden: string | null }[] = [];
    if (shell) {
      for (const child of Array.from(shell.children)) {
        if (!(child instanceof HTMLElement) || child === layer || child.contains(layer)) continue;
        inerted.push({ element: child, hadInert: child.hasAttribute('inert'), ariaHidden: child.getAttribute('aria-hidden') });
        child.setAttribute('inert', '');
        child.setAttribute('aria-hidden', 'true');
      }
    }
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    const initial = (initialFocusSelector ? dialog.querySelector<HTMLElement>(initialFocusSelector) : null)
      ?? dialog.querySelector<HTMLElement>('[data-autofocus]')
      ?? focusableIn(dialog)[0]
      ?? dialog;
    initial.focus();
    if (!dialog.contains(document.activeElement)) (focusableIn(dialog)[0] ?? dialog).focus();
    layers.push(layer);

    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || layers[layers.length - 1] !== layer) return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const index = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
      if (event.shiftKey ? index <= 0 : index === -1 || index === items.length - 1) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };
    document.addEventListener('keydown', trapTab, true);

    return () => {
      document.removeEventListener('keydown', trapTab, true);
      const index = layers.lastIndexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      for (const entry of inerted) {
        if (!entry.hadInert) entry.element.removeAttribute('inert');
        if (entry.ariaHidden === null) entry.element.removeAttribute('aria-hidden');
        else entry.element.setAttribute('aria-hidden', entry.ariaHidden);
      }
      if (layers.length > 0) {
        const top = layers[layers.length - 1];
        const topDialog = top.querySelector<HTMLElement>('[role="dialog"]') ?? top;
        if (!topDialog.contains(document.activeElement)) (focusableIn(topDialog)[0] ?? topDialog).focus();
        return;
      }
      const target = previous?.isConnected
        ? previous
        : fallbackFocusSelector ? document.querySelector<HTMLElement>(fallbackFocusSelector) : null;
      if (target && !target.closest('[inert]')) target.focus();
    };
  }, [layerRef, initialFocusSelector, fallbackFocusSelector]);
}
