import { describe, expect, it } from "vitest";
import { clampSidebarWidth } from "./sidebarPreferences";

describe("clampSidebarWidth", () => {
  it("keeps the Pi sidebar between 220 and 420 pixels", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(900)).toBe(420);
  });
});
