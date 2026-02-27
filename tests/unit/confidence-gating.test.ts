import { describe, expect, it } from "bun:test";
import { shouldDisplayExtraction, shouldStoreExtraction } from "../../app/src/server/extraction/validation";

describe("confidence gating", () => {
  it("drops entities below store threshold", () => {
    expect(shouldStoreExtraction(0.59, 0.6)).toBe(false);
  });

  it("stores at 0.60 but does not display", () => {
    expect(shouldStoreExtraction(0.6, 0.6)).toBe(true);
    expect(shouldDisplayExtraction(0.6, 0.85)).toBe(false);
  });

  it("stores at 0.84 but does not display", () => {
    expect(shouldStoreExtraction(0.84, 0.6)).toBe(true);
    expect(shouldDisplayExtraction(0.84, 0.85)).toBe(false);
  });

  it("stores and displays at 0.85", () => {
    expect(shouldStoreExtraction(0.85, 0.6)).toBe(true);
    expect(shouldDisplayExtraction(0.85, 0.85)).toBe(true);
  });

  it("stores and displays at 1.0", () => {
    expect(shouldStoreExtraction(1.0, 0.6)).toBe(true);
    expect(shouldDisplayExtraction(1.0, 0.85)).toBe(true);
  });
});
