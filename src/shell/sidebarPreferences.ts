import type { ViewId } from "../types";

export const PI_SIDEBAR_MIN = 220;
export const PI_SIDEBAR_MAX = 420;
export const PI_SIDEBAR_DEFAULT = 280;

export const SKILLS_SIDEBAR_MIN = 140;
export const SKILLS_SIDEBAR_MAX = 300;
export const SKILLS_SIDEBAR_DEFAULT = 176;

const WIDTH_KEY = "aster.sidebar.pi.width";
const HIDDEN_KEY = "aster.sidebar.pi.hidden";
const SKILLS_WIDTH_KEY = "aster.sidebar.skills.width";
const SKILLS_HIDDEN_KEY = "aster.sidebar.skills.hidden";
const LEGACY_WIDTHS_KEY = "aster.sideWidths";

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

export function clampSkillsSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SKILLS_SIDEBAR_DEFAULT;
  return Math.min(SKILLS_SIDEBAR_MAX, Math.max(SKILLS_SIDEBAR_MIN, Math.round(value)));
}

function readLegacySkillsWidth(): number | null {
  try {
    const raw = localStorage.getItem(LEGACY_WIDTHS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { slim?: unknown };
    if (typeof parsed?.slim === "number") return clampSkillsSidebarWidth(parsed.slim);
    return null;
  } catch {
    return null;
  }
}

export function loadSkillsSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SKILLS_WIDTH_KEY);
    if (raw) return clampSkillsSidebarWidth(Number(raw));
    const legacy = readLegacySkillsWidth();
    if (legacy != null) {
      saveSkillsSidebarWidth(legacy);
      return legacy;
    }
    return SKILLS_SIDEBAR_DEFAULT;
  } catch {
    return SKILLS_SIDEBAR_DEFAULT;
  }
}

export function saveSkillsSidebarWidth(value: number): number {
  const next = clampSkillsSidebarWidth(value);
  try {
    localStorage.setItem(SKILLS_WIDTH_KEY, String(next));
  } catch (err) {
    console.debug("Failed to persist Skills sidebar width:", err);
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