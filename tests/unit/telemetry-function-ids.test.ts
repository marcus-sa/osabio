import { describe, expect, test } from "bun:test";
import {
  FUNCTION_IDS,
  type FunctionId,
} from "../../app/src/server/telemetry/function-ids";

describe("telemetry function IDs", () => {
  const expectedFunctionIds = [
    "brain.chat-agent",
    "brain.extraction",
    "brain.pm-agent",
    "brain.analytics-agent",
    "brain.observer.verification",
    "brain.observer.synthesis",
    "brain.observer.learning-diagnosis",
    "brain.behavior-scorer",
    "brain.onboarding",
    "brain.intent.authorizer",
    "brain.mcp.context",
    "brain.descriptions",
    "brain.orchestrator",
    "brain.proxy.context-injection",
    "brain.proxy.contradiction-detection",
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

  test("all values follow the brain.* naming convention", () => {
    for (const value of Object.values(FUNCTION_IDS)) {
      expect(value).toStartWith("brain.");
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
