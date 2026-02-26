import { describe, expect, it } from "bun:test";
import { isPlaceholderEntityName } from "../../app/src/server/extraction/filtering";

describe("placeholder filter", () => {
  it("blocks known placeholder phrases", () => {
    expect(isPlaceholderEntityName("my project")).toBe(true);
    expect(isPlaceholderEntityName("the thing")).toBe(true);
    expect(isPlaceholderEntityName("this idea")).toBe(true);
    expect(isPlaceholderEntityName("our app")).toBe(true);
  });

  it("allows real names that only contain blocked words", () => {
    expect(isPlaceholderEntityName("My Project Manager Tool")).toBe(false);
    expect(isPlaceholderEntityName("The App Factory")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isPlaceholderEntityName("My PrOjEcT")).toBe(true);
  });

  it("handles surrounding whitespace", () => {
    expect(isPlaceholderEntityName("   my project   ")).toBe(true);
  });
});
