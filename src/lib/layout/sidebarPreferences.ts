export const PI_SIDEBAR_MIN = 220;
export const PI_SIDEBAR_MAX = 420;
export const PI_SIDEBAR_DEFAULT = 280;

const WIDTH_KEY = "aster.sidebar.pi.width";
const HIDDEN_KEY = "aster.sidebar.pi.hidden";

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return PI_SIDEBAR_DEFAULT;
  return Math.min(PI_SIDEBAR_MAX, Math.max(PI_SIDEBAR_MIN, Math.round(value)));
}

export function loadPiSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return PI_SIDEBAR_DEFAULT;
    return clampSidebarWidth(Number(raw));
  } catch {
    return PI_SIDEBAR_DEFAULT;
  }
}

export function savePiSidebarWidth(value: number): number {
  const next = clampSidebarWidth(value);
  try {
    localStorage.setItem(WIDTH_KEY, String(next));
  } catch (err) {
    console.debug("Failed to persist Pi sidebar width:", err);
  }
  return next;
}

export function loadPiSidebarHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePiSidebarHidden(hidden: boolean): boolean {
  try {
    localStorage.setItem(HIDDEN_KEY, hidden ? "1" : "0");
  } catch (err) {
    console.debug("Failed to persist Pi sidebar visibility:", err);
  }
  return hidden;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
