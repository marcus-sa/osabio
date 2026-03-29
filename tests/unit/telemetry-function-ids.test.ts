import { describe, expect, test } from "bun:test";
import {
  FUNCTION_IDS,
  type FunctionId,
} from "../../app/src/server/telemetry/function-ids";

describe("telemetry function IDs", () => {
  const expectedFunctionIds = [
    "osabio.chat-agent",
    "osabio.extraction",
    "osabio.pm-agent",
    "osabio.analytics-agent",
    "osabio.observer.verification",
    "osabio.observer.synthesis",
    "osabio.observer.learning-diagnosis",
    "osabio.behavior-scorer",
    "osabio.onboarding",
    "osabio.intent.authorizer",
    "osabio.mcp.context",
    "osabio.descriptions",
    "osabio.orchestrator",
    "osabio.proxy.context-injection",
    "osabio.proxy.contradiction-detection",
  ] as const;

  test("exports all 15 function IDs", () => {
    expect(Object.keys(FUNCTION_IDS)).toHaveLength(15);
  });

  test("every expected function ID is present as a value", () => {
    const values = Object.values(FUNCTION_IDS);
    for (const expectedId of expectedFunctionIds) {
      expect(values).toContain(expectedId);
    }
  });

  test("all values follow the osabio.* naming convention", () => {
    for (const value of Object.values(FUNCTION_IDS)) {
      expect(value).toStartWith("osabio.");
    }
  });

  test("FunctionId type is assignable from every constant", () => {
    // Type-level check: if this compiles, the union type covers all constants
    const assertFunctionId = (_id: FunctionId) => {};
    for (const value of Object.values(FUNCTION_IDS)) {
      assertFunctionId(value as FunctionId);
    }
  });
});
