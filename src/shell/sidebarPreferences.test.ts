import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampSidebarWidth,
  isSidebarVisible,
  loadPiSidebarHidden,
  loadSkillsSidebarHidden,
  savePiSidebarHidden,
  saveSkillsSidebarHidden,
} from "./sidebarPreferences";

// Vitest 环境为 node，无原生 localStorage；用 Map 模拟。
const store = new Map<string, string>();

function installLocalStorageStub() {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

beforeEach(() => {
  store.clear();
  installLocalStorageStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampSidebarWidth", () => {
  it("keeps the Pi sidebar between 220 and 420 pixels", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(900)).toBe(420);
  });
});

describe("Pi sidebar hidden preference", () => {
  it("defaults to visible when no key is stored", () => {
    expect(loadPiSidebarHidden()).toBe(false);
  });

  it("round-trips save then load", () => {
    savePiSidebarHidden(true);
    expect(loadPiSidebarHidden()).toBe(true);
    savePiSidebarHidden(false);
    expect(loadPiSidebarHidden()).toBe(false);
  });

  it("falls back to visible on garbage values", () => {
    store.set("aster.sidebar.pi.hidden", "banana");
    expect(loadPiSidebarHidden()).toBe(false);
    store.set("aster.sidebar.pi.hidden", "0");
    expect(loadPiSidebarHidden()).toBe(false);
  });
});

describe("Skills sidebar hidden preference", () => {
  it("defaults to visible when no key is stored", () => {
    expect(loadSkillsSidebarHidden()).toBe(false);
  });

  it("round-trips save then load", () => {
    saveSkillsSidebarHidden(true);
    expect(loadSkillsSidebarHidden()).toBe(true);
    saveSkillsSidebarHidden(false);
    expect(loadSkillsSidebarHidden()).toBe(false);
  });

  it("falls back to visible on garbage values", () => {
    store.set("aster.sidebar.skills.hidden", "banana");
    expect(loadSkillsSidebarHidden()).toBe(false);
    store.set("aster.sidebar.skills.hidden", "0");
    expect(loadSkillsSidebarHidden()).toBe(false);
  });

  it("does not collide with the Pi hidden key", () => {
    saveSkillsSidebarHidden(true);
    expect(loadPiSidebarHidden()).toBe(false);
    savePiSidebarHidden(true);
    expect(loadSkillsSidebarHidden()).toBe(true);
  });
});

describe("isSidebarVisible", () => {
  it("keeps DSH sidebar always hidden regardless of flags", () => {
    expect(isSidebarVisible("dsh", false, false)).toBe(false);
    expect(isSidebarVisible("dsh", true, true)).toBe(false);
  });

  it("reflects only the Pi hidden flag for pi", () => {
    expect(isSidebarVisible("pi", false, true)).toBe(true);
    expect(isSidebarVisible("pi", true, false)).toBe(false);
  });

  it("reflects only the Skills hidden flag for skills", () => {
    expect(isSidebarVisible("skills", true, false)).toBe(true);
    expect(isSidebarVisible("skills", false, true)).toBe(false);
  });
});