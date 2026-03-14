/**
 * Definition Matcher (US-DB-002, Step 02-01)
 *
 * Pure function that filters behavior definitions by status and telemetry type.
 * No side effects, no DB access -- receives pre-fetched definitions.
 *
 * Filter criteria:
 *   1. status === "active"
 *   2. telemetry_types array includes the submitted telemetry type
 */
import type { BehaviorDefinitionRecord } from "./definition-types";

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const isActive = (definition: BehaviorDefinitionRecord): boolean =>
  definition.status === "active";

const matchesTelemetryType =
  (telemetryType: string) =>
  (definition: BehaviorDefinitionRecord): boolean =>
    definition.telemetry_types.includes(telemetryType);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filters behavior definitions to those that are active and match the
 * given telemetry type. Returns a new array -- never mutates the input.
 *
 * @param definitions - Pre-fetched behavior definitions (from DB query)
 * @param telemetryType - The telemetry event type to match against
 * @returns Active definitions whose telemetry_types include telemetryType
 */
export const matchDefinitions = (
  definitions: readonly BehaviorDefinitionRecord[],
  telemetryType: string,
): BehaviorDefinitionRecord[] =>
  definitions.filter(
    (definition) => isActive(definition) && matchesTelemetryType(telemetryType)(definition),
  );
