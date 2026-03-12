/**
 * Unit tests for anomaly evaluation Zod schemas.
 *
 * Validates that the anomalyEvaluationResultSchema correctly
 * parses LLM structured output for stale/drift anomaly evaluation.
 */
import { describe, expect, it } from "bun:test";
import { anomalyEvaluationResultSchema } from "../../../app/src/server/observer/schemas";

describe("anomalyEvaluationResultSchema", () => {
  it("parses valid evaluation with relevant=true", () => {
    const input = {
      evaluations: [
        {
          entity_ref: "task:abc-123",
          relevant: true,
          reasoning: "This task has been blocked for 30 days with no clear external dependency.",
          suggested_severity: "warning",
        },
      ],
    };

    const result = anomalyEvaluationResultSchema.parse(input);
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].relevant).toBe(true);
    expect(result.evaluations[0].suggested_severity).toBe("warning");
  });

  it("parses valid evaluation with relevant=false", () => {
    const input = {
      evaluations: [
        {
          entity_ref: "task:def-456",
          relevant: false,
          reasoning: "This task is waiting on an external vendor, which is expected.",
          suggested_severity: "info",
        },
      ],
    };

    const result = anomalyEvaluationResultSchema.parse(input);
    expect(result.evaluations[0].relevant).toBe(false);
    expect(result.evaluations[0].suggested_severity).toBe("info");
  });

  it("parses multiple evaluations", () => {
    const input = {
      evaluations: [
        {
          entity_ref: "task:abc-123",
          relevant: true,
          reasoning: "Genuinely stuck.",
          suggested_severity: "conflict",
        },
        {
          entity_ref: "task:def-456",
          relevant: false,
          reasoning: "Expected wait.",
          suggested_severity: "info",
        },
      ],
    };

    const result = anomalyEvaluationResultSchema.parse(input);
    expect(result.evaluations).toHaveLength(2);
  });

  it("parses empty evaluations array", () => {
    const input = { evaluations: [] };
    const result = anomalyEvaluationResultSchema.parse(input);
    expect(result.evaluations).toHaveLength(0);
  });

  it("rejects invalid severity value", () => {
    const input = {
      evaluations: [
        {
          entity_ref: "task:abc-123",
          relevant: true,
          reasoning: "Test",
          suggested_severity: "critical",
        },
      ],
    };

    expect(() => anomalyEvaluationResultSchema.parse(input)).toThrow();
  });

  it("rejects missing required fields", () => {
    const input = {
      evaluations: [
        {
          entity_ref: "task:abc-123",
          relevant: true,
          // missing reasoning and suggested_severity
        },
      ],
    };

    expect(() => anomalyEvaluationResultSchema.parse(input)).toThrow();
  });
});
