/**
 * Behavior Scorer Unit Tests
 *
 * Pure function tests for the scorer module. No IO, no database,
 * just data transformation: telemetry -> validated score.
 *
 * scorer.ts must have zero IO imports.
 */
import { describe, expect, it } from "bun:test";
import {
  scoreTddAdherence,
  scoreSecurityFirst,
  scoreTelemetry,
  validateTelemetryShape,
  type TddTelemetry,
  type SecurityTelemetry,
  type ScorerResult,
} from "../../app/src/server/behavior/scorer";

// =============================================================================
// TDD Adherence Scorer
// =============================================================================
describe("scoreTddAdherence", () => {
  it("returns score proportional to test-to-file ratio", () => {
    const telemetry: TddTelemetry = {
      metric_type: "TDD_Adherence",
      files_changed: 10,
      test_files_changed: 5,
    };
    const result = scoreTddAdherence(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it("returns 0.0 when no test files changed", () => {
    const telemetry: TddTelemetry = {
      metric_type: "TDD_Adherence",
      files_changed: 10,
      test_files_changed: 0,
    };
    const result = scoreTddAdherence(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(0.0);
  });

  it("caps score at 1.0 when test files exceed total files", () => {
    const telemetry: TddTelemetry = {
      metric_type: "TDD_Adherence",
      files_changed: 3,
      test_files_changed: 5,
    };
    const result = scoreTddAdherence(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("returns 0.0 when zero files changed", () => {
    const telemetry: TddTelemetry = {
      metric_type: "TDD_Adherence",
      files_changed: 0,
      test_files_changed: 0,
    };
    const result = scoreTddAdherence(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(0.0);
  });
});

// =============================================================================
// Security First Scorer
// =============================================================================
describe("scoreSecurityFirst", () => {
  it("returns score proportional to addressed advisories", () => {
    const telemetry: SecurityTelemetry = {
      metric_type: "Security_First",
      cve_advisories_in_context: 4,
      cve_advisories_addressed: 3,
    };
    const result = scoreSecurityFirst(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(0.75);
  });

  it("returns 1.0 when all advisories addressed", () => {
    const telemetry: SecurityTelemetry = {
      metric_type: "Security_First",
      cve_advisories_in_context: 2,
      cve_advisories_addressed: 2,
    };
    const result = scoreSecurityFirst(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("returns 1.0 when no advisories in context", () => {
    const telemetry: SecurityTelemetry = {
      metric_type: "Security_First",
      cve_advisories_in_context: 0,
      cve_advisories_addressed: 0,
    };
    const result = scoreSecurityFirst(telemetry);
    expect(result.success).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

// =============================================================================
// Telemetry Shape Validation
// =============================================================================
describe("validateTelemetryShape", () => {
  it("validates TDD_Adherence telemetry shape", () => {
    const result = validateTelemetryShape("TDD_Adherence", {
      files_changed: 10,
      test_files_changed: 3,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects TDD_Adherence telemetry missing required fields", () => {
    const result = validateTelemetryShape("TDD_Adherence", {
      files_changed: 10,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("test_files_changed");
  });

  it("validates Security_First telemetry shape", () => {
    const result = validateTelemetryShape("Security_First", {
      cve_advisories_in_context: 2,
      cve_advisories_addressed: 1,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects Security_First telemetry missing required fields", () => {
    const result = validateTelemetryShape("Security_First", {
      cve_advisories_in_context: 2,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("cve_advisories_addressed");
  });

  it("rejects unknown metric type with sanitized name", () => {
    const result = validateTelemetryShape("unknown_metric", {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("unknown_metric");
  });

  it("sanitizes special characters in unknown metric type", () => {
    const result = validateTelemetryShape("<script>alert('xss')</script>", {});
    expect(result.valid).toBe(false);
    expect(result.reason).not.toContain("<script>");
    expect(result.reason).toContain("Known types:");
  });

  it("rejects non-numeric values in required fields", () => {
    const result = validateTelemetryShape("TDD_Adherence", {
      files_changed: "not_a_number",
      test_files_changed: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Non-numeric");
    expect(result.reason).toContain("files_changed");
  });

  it("rejects boolean values in numeric fields", () => {
    const result = validateTelemetryShape("Security_First", {
      cve_advisories_in_context: true,
      cve_advisories_addressed: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Non-numeric");
  });
});
