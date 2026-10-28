import { useEffect, type RefObject } from 'react';

/*
 * Adapted from Caho1/open-claude-ui, code-examples/useClaudeRovingFocus.ts,
 * MIT, commit c1f923ae0051a871941b98a0e2e3183a545e6a85.
 * Menus move focus with the arrow keys; Tab leaves the group.
 */
export function useMenuFocus(menuKey: string | null, panel: RefObject<HTMLElement | null>, ready = true): void {
  useEffect(() => {
    if (!menuKey || !ready) return;
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([aria-disabled="true"]):not(:disabled)',
    ) ?? []).filter(item => item.closest('[role="menu"]') === panel.current
      && item.getClientRects().length > 0 && !item.closest('[inert], [aria-hidden="true"]'));
    const initial = items();
    (initial.find(item => item.getAttribute('aria-checked') === 'true') ?? initial[0])?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="menu"]') !== panel.current) return;
      const list = items();
      if (list.length === 0) return;
      event.preventDefault();
      const current = list.indexOf(document.activeElement as HTMLElement);
      const base = current < 0 ? (event.key === 'ArrowUp' ? 0 : -1) : current;
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? list.length - 1
        : event.key === 'ArrowDown' ? (base + 1 + list.length) % list.length
        : (base - 1 + list.length) % list.length;
      list[next]?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuKey, panel, ready]);
}
