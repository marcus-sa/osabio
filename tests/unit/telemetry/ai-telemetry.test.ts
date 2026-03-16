import { describe, expect, test } from "bun:test";
import { createTelemetryConfig, recordLlmMetrics, recordLlmError } from "../../../app/src/server/telemetry/ai-telemetry";
import { FUNCTION_IDS } from "../../../app/src/server/telemetry/function-ids";

describe("createTelemetryConfig", () => {
  test("returns enabled telemetry config with functionId and service metadata", () => {
    const config = createTelemetryConfig(FUNCTION_IDS.EXTRACTION);

    expect(config).toEqual({
      isEnabled: true,
      functionId: "brain.extraction",
      metadata: { service: "brain-server" },
    });
  });

  test("returns correct functionId for each taxonomy entry", () => {
    for (const [, functionId] of Object.entries(FUNCTION_IDS)) {
      const config = createTelemetryConfig(functionId);
      expect(config.functionId).toBe(functionId);
      expect(config.isEnabled).toBe(true);
      expect(config.metadata).toEqual({ service: "brain-server" });
    }
  });
});

describe("recordLlmMetrics", () => {
  test("records metrics without throwing when called with valid usage", () => {
    // Should not throw - metrics are no-ops when no MeterProvider is registered
    expect(() => {
      recordLlmMetrics(FUNCTION_IDS.CHAT_AGENT, { promptTokens: 100, completionTokens: 50 }, 1234);
    }).not.toThrow();
  });

  test("handles zero values gracefully", () => {
    expect(() => {
      recordLlmMetrics(FUNCTION_IDS.EXTRACTION, { promptTokens: 0, completionTokens: 0 }, 0);
    }).not.toThrow();
  });

  test("handles undefined token counts gracefully", () => {
    expect(() => {
      recordLlmMetrics(FUNCTION_IDS.PM_AGENT, {}, 500);
    }).not.toThrow();
  });
});

describe("recordLlmError", () => {
  test("increments error counter without throwing", () => {
    expect(() => {
      recordLlmError(FUNCTION_IDS.OBSERVER_VERIFICATION, "timeout");
    }).not.toThrow();
  });

  test("accepts any error type string", () => {
    expect(() => {
      recordLlmError(FUNCTION_IDS.BEHAVIOR_SCORER, "rate_limit");
      recordLlmError(FUNCTION_IDS.INTENT_AUTHORIZER, "invalid_output");
      recordLlmError(FUNCTION_IDS.ONBOARDING, "network_error");
    }).not.toThrow();
  });
});
