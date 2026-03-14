/**
 * Behavior Scorer -- Pure Functions
 *
 * Maps raw telemetry data to normalized 0-1 scores per metric type.
 * This module has ZERO IO imports. It is pure data transformation only.
 *
 * Each metric type has:
 *   1. A discriminated union type for its telemetry shape
 *   2. A scorer function: telemetry -> ScorerResult
 *   3. A validation function for runtime shape checking
 */

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export type ScorerResult =
  | { success: true; score: number }
  | { success: false; reason: string };

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

// ---------------------------------------------------------------------------
// Telemetry Types (Discriminated Union)
// ---------------------------------------------------------------------------

export type TddTelemetry = {
  metric_type: "TDD_Adherence";
  files_changed: number;
  test_files_changed: number;
  coverage_delta?: number;
};

export type SecurityTelemetry = {
  metric_type: "Security_First";
  cve_advisories_in_context: number;
  cve_advisories_addressed: number;
};

export type BehaviorTelemetry = TddTelemetry | SecurityTelemetry;

// ---------------------------------------------------------------------------
// Known Metric Types
// ---------------------------------------------------------------------------

export const KNOWN_METRIC_TYPES = [
  "TDD_Adherence",
  "Security_First",
  "Conciseness",
  "Review_Responsiveness",
  "Documentation_Quality",
] as const;

export type MetricType = (typeof KNOWN_METRIC_TYPES)[number];

// ---------------------------------------------------------------------------
// Scorer Functions
// ---------------------------------------------------------------------------

function clampScore(value: number): number {
  return Math.min(1.0, Math.max(0.0, value));
}

/**
 * Scores TDD adherence as the ratio of test files changed to total files changed.
 * Score is clamped to [0.0, 1.0].
 */
export function scoreTddAdherence(telemetry: TddTelemetry): ScorerResult {
  const { files_changed, test_files_changed } = telemetry;

  if (files_changed === 0) {
    return { success: true, score: 0.0 };
  }

  return { success: true, score: clampScore(test_files_changed / files_changed) };
}

/**
 * Scores security-first behavior as the ratio of addressed CVE advisories
 * to total advisories in context. Returns 1.0 when no advisories exist.
 */
export function scoreSecurityFirst(telemetry: SecurityTelemetry): ScorerResult {
  const { cve_advisories_in_context, cve_advisories_addressed } = telemetry;

  if (cve_advisories_in_context === 0) {
    return { success: true, score: 1.0 };
  }

  return { success: true, score: clampScore(cve_advisories_addressed / cve_advisories_in_context) };
}

// ---------------------------------------------------------------------------
// Telemetry Shape Validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<string, string[]> = {
  TDD_Adherence: ["files_changed", "test_files_changed"],
  Security_First: ["cve_advisories_in_context", "cve_advisories_addressed"],
};

/**
 * Validates that raw telemetry data has the required fields for a metric type.
 * Pure runtime validation -- no IO, no schema lookups.
 */
export function validateTelemetryShape(
  metricType: string,
  telemetry: Record<string, unknown>,
): ValidationResult {
  const requiredFields = REQUIRED_FIELDS[metricType];

  if (!requiredFields) {
    const sanitizedType = String(metricType).slice(0, 100).replace(/[^\w_-]/g, "_");
    return {
      valid: false,
      reason: `Unknown metric type: ${sanitizedType}. Known types: ${Object.keys(REQUIRED_FIELDS).join(", ")}`,
    };
  }

  const missingFields = requiredFields.filter(
    (field) => telemetry[field] === undefined,
  );

  if (missingFields.length > 0) {
    return {
      valid: false,
      reason: `Missing required fields for ${metricType}: ${missingFields.join(", ")}`,
    };
  }

  const nonNumericFields = requiredFields.filter(
    (field) => typeof telemetry[field] !== "number",
  );

  if (nonNumericFields.length > 0) {
    return {
      valid: false,
      reason: `Non-numeric values for ${metricType}: ${nonNumericFields.join(", ")}`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Score Dispatcher
// ---------------------------------------------------------------------------

/**
 * Scores telemetry for any known metric type. Validates shape, then delegates
 * to the appropriate scorer function.
 */
export function scoreTelemetry(
  metricType: string,
  telemetry: Record<string, unknown>,
): ScorerResult {
  const validation = validateTelemetryShape(metricType, telemetry);
  if (!validation.valid) {
    return { success: false, reason: validation.reason };
  }

  switch (metricType) {
    case "TDD_Adherence":
      return scoreTddAdherence({
        metric_type: "TDD_Adherence",
        files_changed: telemetry.files_changed as number,
        test_files_changed: telemetry.test_files_changed as number,
        coverage_delta: telemetry.coverage_delta as number | undefined,
      });
    case "Security_First":
      return scoreSecurityFirst({
        metric_type: "Security_First",
        cve_advisories_in_context: telemetry.cve_advisories_in_context as number,
        cve_advisories_addressed: telemetry.cve_advisories_addressed as number,
      });
    default:
      return { success: false, reason: `No scorer implemented for metric type: ${String(metricType).slice(0, 100).replace(/[^\w_-]/g, "_")}` };
  }
}
