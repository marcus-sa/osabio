/**
 * Unit tests for learning library shared contracts.
 *
 * Validates KNOWN_LEARNING_TARGET_AGENTS constant structure and values.
 */
import { describe, expect, it } from "bun:test";
import { KNOWN_LEARNING_TARGET_AGENTS } from "../../../app/src/shared/contracts";

describe("KNOWN_LEARNING_TARGET_AGENTS", () => {
  it("exports an array of agent entries with value and label", () => {
    expect(Array.isArray(KNOWN_LEARNING_TARGET_AGENTS)).toBe(true);
    expect(KNOWN_LEARNING_TARGET_AGENTS.length).toBeGreaterThan(0);

    for (const entry of KNOWN_LEARNING_TARGET_AGENTS) {
      expect(typeof entry.value).toBe("string");
      expect(typeof entry.label).toBe("string");
      expect(entry.value.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("includes all required agent types", () => {
    const values = KNOWN_LEARNING_TARGET_AGENTS.map((a) => a.value);
    expect(values).toContain("chat_agent");
    expect(values).toContain("pm_agent");
    expect(values).toContain("observer_agent");
    expect(values).toContain("mcp");
  });

  it("has unique values", () => {
    const values = KNOWN_LEARNING_TARGET_AGENTS.map((a) => a.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
