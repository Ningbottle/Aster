import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampSidebarWidth,
  clampSkillsSidebarWidth,
  isSidebarVisible,
  loadPiSidebarHidden,
  loadSkillsSidebarHidden,
  loadSkillsSidebarWidth,
  savePiSidebarHidden,
  saveSkillsSidebarHidden,
  saveSkillsSidebarWidth,
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

describe("Skills sidebar width preference", () => {
  it("clamps Skills width between 140 and 300", () => {
    expect(clampSkillsSidebarWidth(10)).toBe(140);
    expect(clampSkillsSidebarWidth(176)).toBe(176);
    expect(clampSkillsSidebarWidth(900)).toBe(300);
  });

  it("round-trips save then load on the dedicated key", () => {
    saveSkillsSidebarWidth(236);
    expect(loadSkillsSidebarWidth()).toBe(236);
    expect(store.get("aster.sidebar.skills.width")).toBe("236");
  });

  it("migrates a legacy aster.sideWidths.slim value once", () => {
    store.set("aster.sideWidths", JSON.stringify({ slim: 200, full: 248 }));
    expect(loadSkillsSidebarWidth()).toBe(200);
    expect(store.get("aster.sidebar.skills.width")).toBe("200");
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