/**
 * Unit Tests: Definition Matcher (US-DB-002, Step 02-01)
 *
 * Pure function that filters behavior definitions by:
 *   1. status === "active"
 *   2. telemetry_types includes the submitted telemetry type
 *
 * Behaviors tested:
 *   B1: Returns active definitions matching the telemetry type
 *   B2: Excludes draft definitions
 *   B3: Excludes archived definitions
 *   B4: Returns empty array when no definitions match
 *   B5: Returns multiple definitions when several match
 *   B6: Does not mutate input array
 *
 * Budget: 6 behaviors -> max 12 tests, using 6.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { matchDefinitions } from "../../../app/src/server/behavior/definition-matcher";
import type { BehaviorDefinitionRecord } from "../../../app/src/server/behavior/definition-types";

// ---------------------------------------------------------------------------
// Test Data Factory
// ---------------------------------------------------------------------------

function buildDefinition(
  overrides: Partial<BehaviorDefinitionRecord> & { id_suffix?: string } = {},
): BehaviorDefinitionRecord {
  const suffix = overrides.id_suffix ?? crypto.randomUUID();
  const { id_suffix: _, ...rest } = overrides;
  return {
    id: new RecordId("behavior_definition", `def-${suffix}`),
    title: "Test Definition",
    goal: "Test goal",
    scoring_logic: "Test logic",
    telemetry_types: ["chat_response"],
    status: "active",
    version: 1,
    enforcement_mode: "warn_only",
    workspace: new RecordId("workspace", "ws-test"),
    created_at: new Date().toISOString(),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("matchDefinitions", () => {
  it("returns active definitions whose telemetry_types include the submitted type", () => {
    const honesty = buildDefinition({
      title: "Honesty",
      telemetry_types: ["chat_response", "decision_proposal"],
      status: "active",
    });

    const result = matchDefinitions([honesty], "chat_response");

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Honesty");
  });

  it("excludes draft definitions even when telemetry type matches", () => {
    const draft = buildDefinition({
      title: "Draft Behavior",
      telemetry_types: ["chat_response"],
      status: "draft",
    });

    const result = matchDefinitions([draft], "chat_response");

    expect(result).toHaveLength(0);
  });

  it("excludes archived definitions even when telemetry type matches", () => {
    const archived = buildDefinition({
      title: "Archived Behavior",
      telemetry_types: ["chat_response"],
      status: "archived",
    });

    const result = matchDefinitions([archived], "chat_response");

    expect(result).toHaveLength(0);
  });

  it("returns empty array when no definitions match the telemetry type", () => {
    const chatOnly = buildDefinition({
      title: "Chat Only",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const result = matchDefinitions([chatOnly], "commit");

    expect(result).toHaveLength(0);
  });

  it("returns multiple definitions when several match the same telemetry type", () => {
    const honesty = buildDefinition({
      id_suffix: "1",
      title: "Honesty",
      telemetry_types: ["chat_response"],
      status: "active",
    });
    const evidence = buildDefinition({
      id_suffix: "2",
      title: "Evidence-Based Reasoning",
      telemetry_types: ["chat_response", "decision_proposal"],
      status: "active",
    });
    const tdd = buildDefinition({
      id_suffix: "3",
      title: "TDD Adherence",
      telemetry_types: ["agent_session"],
      status: "active",
    });

    const result = matchDefinitions([honesty, evidence, tdd], "chat_response");

    expect(result).toHaveLength(2);
    const titles = result.map((d) => d.title).sort();
    expect(titles).toEqual(["Evidence-Based Reasoning", "Honesty"]);
  });

  it("does not mutate the input array", () => {
    const definitions = [
      buildDefinition({ status: "active", telemetry_types: ["chat_response"] }),
      buildDefinition({ status: "draft", telemetry_types: ["chat_response"] }),
    ];
    const originalLength = definitions.length;

    matchDefinitions(definitions, "chat_response");

    expect(definitions).toHaveLength(originalLength);
  });
});
