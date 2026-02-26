import { describe, expect, it } from "bun:test";
import { shouldRunExtractionForRole } from "../../app/src/server/extraction/roles";

describe("message role filter", () => {
  it("runs extraction for user messages", () => {
    expect(shouldRunExtractionForRole("user")).toBe(true);
  });

  it("skips extraction for assistant messages", () => {
    expect(shouldRunExtractionForRole("assistant")).toBe(false);
  });

  it("skips extraction for system messages", () => {
    expect(shouldRunExtractionForRole("system")).toBe(false);
  });
});
