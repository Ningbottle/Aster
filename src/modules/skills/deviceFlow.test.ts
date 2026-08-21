import { describe, expect, it } from "vitest";
import { shouldDiscardFlow } from "./deviceFlow";

describe("shouldDiscardFlow", () => {
  it("discards when the modal is hidden", () => {
    expect(shouldDiscardFlow({ show: false, flowGeneration: 2, generation: 2 })).toBe(true);
  });

  it("discards a stale generation after close/reset", () => {
    expect(shouldDiscardFlow({ show: true, flowGeneration: 3, generation: 2 })).toBe(true);
  });

  it("applies the in-flight generation while visible", () => {
    expect(shouldDiscardFlow({ show: true, flowGeneration: 2, generation: 2 })).toBe(false);
  });
});
