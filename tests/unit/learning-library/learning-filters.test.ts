/**
 * Unit tests for LearningFilters pure logic.
 *
 * Tests the filter option definitions and label mappings
 * that drive the LearningFilters component dropdowns.
 */
import { describe, expect, it } from "bun:test";
import {
  TYPE_FILTER_OPTIONS,
  AGENT_FILTER_OPTIONS,
  type FilterOption,
} from "../../../app/src/client/components/learning/LearningFilters";
import { LEARNING_TYPES, KNOWN_LEARNING_TARGET_AGENTS } from "../../../app/src/shared/contracts";

describe("TYPE_FILTER_OPTIONS", () => {
  it("includes an 'All Types' option with empty string value", () => {
    const allOption = TYPE_FILTER_OPTIONS[0];
    expect(allOption.value).toBe("");
    expect(allOption.label).toBe("All Types");
  });

  it("includes one option per learning type after the 'all' option", () => {
    const typeOptions = TYPE_FILTER_OPTIONS.slice(1);
    expect(typeOptions).toHaveLength(LEARNING_TYPES.length);
  });

  it("maps learning types to human-readable labels", () => {
    const typeOptions = TYPE_FILTER_OPTIONS.slice(1);
    const values = typeOptions.map((opt: FilterOption) => opt.value);
    expect(values).toEqual([...LEARNING_TYPES]);
  });

  it("capitalizes type labels", () => {
    const typeOptions = TYPE_FILTER_OPTIONS.slice(1);
    for (const opt of typeOptions) {
      expect(opt.label[0]).toBe(opt.label[0].toUpperCase());
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe("AGENT_FILTER_OPTIONS", () => {
  it("includes an 'All Agents' option with empty string value", () => {
    const allOption = AGENT_FILTER_OPTIONS[0];
    expect(allOption.value).toBe("");
    expect(allOption.label).toBe("All Agents");
  });

  it("includes one option per known target agent after the 'all' option", () => {
    const agentOptions = AGENT_FILTER_OPTIONS.slice(1);
    expect(agentOptions).toHaveLength(KNOWN_LEARNING_TARGET_AGENTS.length);
  });

  it("uses agent values from KNOWN_LEARNING_TARGET_AGENTS", () => {
    const agentOptions = AGENT_FILTER_OPTIONS.slice(1);
    const values = agentOptions.map((opt: FilterOption) => opt.value);
    const expected = KNOWN_LEARNING_TARGET_AGENTS.map((a) => a.value);
    expect(values).toEqual([...expected]);
  });

  it("uses agent labels from KNOWN_LEARNING_TARGET_AGENTS", () => {
    const agentOptions = AGENT_FILTER_OPTIONS.slice(1);
    const labels = agentOptions.map((opt: FilterOption) => opt.label);
    const expected = KNOWN_LEARNING_TARGET_AGENTS.map((a) => a.label);
    expect(labels).toEqual([...expected]);
  });
});
