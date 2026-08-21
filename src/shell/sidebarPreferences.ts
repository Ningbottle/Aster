import type { ViewId } from "../types";

export const PI_SIDEBAR_MIN = 220;
export const PI_SIDEBAR_MAX = 420;
export const PI_SIDEBAR_DEFAULT = 280;

const WIDTH_KEY = "aster.sidebar.pi.width";
const HIDDEN_KEY = "aster.sidebar.pi.hidden";
const SKILLS_HIDDEN_KEY = "aster.sidebar.skills.hidden";

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

function loadSidebarHidden(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function saveSidebarHidden(key: string, hidden: boolean): boolean {
  try {
    localStorage.setItem(key, hidden ? "1" : "0");
  } catch (err) {
    console.debug("Failed to persist sidebar visibility:", err);
  }
  return hidden;
}

export function loadPiSidebarHidden(): boolean {
  return loadSidebarHidden(HIDDEN_KEY);
}

export function savePiSidebarHidden(hidden: boolean): boolean {
  return saveSidebarHidden(HIDDEN_KEY, hidden);
}

export function loadSkillsSidebarHidden(): boolean {
  return loadSidebarHidden(SKILLS_HIDDEN_KEY);
}

export function saveSkillsSidebarHidden(hidden: boolean): boolean {
  return saveSidebarHidden(SKILLS_HIDDEN_KEY, hidden);
}

export function isSidebarVisible(
  view: ViewId,
  piHidden: boolean,
  skillsHidden: boolean,
): boolean {
  if (view === "dsh") return false;
  return view === "pi" ? !piHidden : !skillsHidden;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}