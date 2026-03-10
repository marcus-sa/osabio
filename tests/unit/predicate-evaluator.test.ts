import { describe, expect, test } from "bun:test";
import {
  resolveDotPath,
  evaluatePredicate,
  evaluateCondition,
} from "../../app/src/server/policy/predicate-evaluator";
import type { RulePredicate } from "../../app/src/server/policy/types";

describe("resolveDotPath", () => {
  test("resolves top-level field", () => {
    const context = { goal: "deploy service" };
    expect(resolveDotPath(context, "goal")).toBe("deploy service");
  });

  test("resolves nested field (action_spec.action)", () => {
    const context = { action_spec: { action: "deploy" } };
    expect(resolveDotPath(context, "action_spec.action")).toBe("deploy");
  });

  test("resolves deeply nested field (action_spec.params.env)", () => {
    const context = { action_spec: { params: { env: "production" } } };
    expect(resolveDotPath(context, "action_spec.params.env")).toBe(
      "production",
    );
  });

  test("returns undefined for missing field", () => {
    const context = { goal: "deploy" };
    expect(resolveDotPath(context, "missing")).toBeUndefined();
  });

  test("returns undefined for missing intermediate path", () => {
    const context = { action_spec: { action: "deploy" } };
    expect(
      resolveDotPath(context, "action_spec.nonexistent.deep"),
    ).toBeUndefined();
  });
});

describe("evaluatePredicate", () => {
  test("eq: matches equal string values", () => {
    const context = { action_spec: { action: "deploy" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "eq",
      value: "deploy",
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("eq: does not match different values", () => {
    const context = { action_spec: { action: "deploy" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "eq",
      value: "delete",
    };
    expect(evaluatePredicate(context, predicate)).toBe(false);
  });

  test("neq: matches different values", () => {
    const context = { action_spec: { action: "deploy" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "neq",
      value: "delete",
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("lt: matches when context value is less", () => {
    const context = { budget_limit: { amount: 50 } };
    const predicate: RulePredicate = {
      field: "budget_limit.amount",
      operator: "lt",
      value: 100,
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("lte: matches when equal", () => {
    const context = { budget_limit: { amount: 100 } };
    const predicate: RulePredicate = {
      field: "budget_limit.amount",
      operator: "lte",
      value: 100,
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("gt: matches when context value is greater", () => {
    const context = { priority: 5 };
    const predicate: RulePredicate = {
      field: "priority",
      operator: "gt",
      value: 3,
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("gte: matches when equal", () => {
    const context = { priority: 3 };
    const predicate: RulePredicate = {
      field: "priority",
      operator: "gte",
      value: 3,
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("in: matches when value is in array", () => {
    const context = { action_spec: { action: "deploy" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "in",
      value: ["deploy", "rollback", "scale"],
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("in: does not match when value not in array", () => {
    const context = { action_spec: { action: "delete" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "in",
      value: ["deploy", "rollback", "scale"],
    };
    expect(evaluatePredicate(context, predicate)).toBe(false);
  });

  test("not_in: matches when value not in array", () => {
    const context = { action_spec: { action: "deploy" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "not_in",
      value: ["delete", "destroy"],
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("exists: matches when field exists", () => {
    const context = { budget_limit: { amount: 100 } };
    const predicate: RulePredicate = {
      field: "budget_limit.amount",
      operator: "exists",
      value: true,
    };
    expect(evaluatePredicate(context, predicate)).toBe(true);
  });

  test("exists: does not match when field missing", () => {
    const context = { goal: "deploy" };
    const predicate: RulePredicate = {
      field: "budget_limit.amount",
      operator: "exists",
      value: true,
    };
    expect(evaluatePredicate(context, predicate)).toBe(false);
  });

  test("returns false for missing field (fail-safe)", () => {
    const context = { goal: "deploy" };
    const predicate: RulePredicate = {
      field: "nonexistent.field",
      operator: "eq",
      value: "anything",
    };
    expect(evaluatePredicate(context, predicate)).toBe(false);
  });
});

describe("evaluateCondition", () => {
  const ruleId = "rule-001";
  const policyId = "policy-001";

  test("single predicate delegates correctly", () => {
    const context = { action_spec: { action: "deploy" } };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "eq",
      value: "deploy",
    };
    const result = evaluateCondition(context, predicate, ruleId, policyId);
    expect(result.matched).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("AND-joined: matches when all predicates true", () => {
    const context = { action_spec: { action: "deploy" }, priority: 5 };
    const conditions: RulePredicate[] = [
      { field: "action_spec.action", operator: "eq", value: "deploy" },
      { field: "priority", operator: "gt", value: 3 },
    ];
    const result = evaluateCondition(context, conditions, ruleId, policyId);
    expect(result.matched).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("AND-joined: does not match when any predicate false", () => {
    const context = { action_spec: { action: "deploy" }, priority: 2 };
    const conditions: RulePredicate[] = [
      { field: "action_spec.action", operator: "eq", value: "deploy" },
      { field: "priority", operator: "gt", value: 3 },
    ];
    const result = evaluateCondition(context, conditions, ruleId, policyId);
    expect(result.matched).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  test("collects warning for missing field", () => {
    const context = { goal: "deploy" };
    const predicate: RulePredicate = {
      field: "nonexistent.field",
      operator: "eq",
      value: "anything",
    };
    const result = evaluateCondition(context, predicate, ruleId, policyId);
    expect(result.matched).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual({
      rule_id: ruleId,
      field: "nonexistent.field",
      policy_id: policyId,
    });
  });

  test("AND-joined with one missing field: no match, warning collected", () => {
    const context = { action_spec: { action: "deploy" } };
    const conditions: RulePredicate[] = [
      { field: "action_spec.action", operator: "eq", value: "deploy" },
      { field: "missing.field", operator: "gt", value: 10 },
    ];
    const result = evaluateCondition(context, conditions, ruleId, policyId);
    expect(result.matched).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual({
      rule_id: ruleId,
      field: "missing.field",
      policy_id: policyId,
    });
  });
});

describe("dedup edge case", () => {
  test("predicate evaluation is deterministic for same input", () => {
    const context = { action_spec: { action: "deploy" }, priority: 5 };
    const predicate: RulePredicate = {
      field: "action_spec.action",
      operator: "eq",
      value: "deploy",
    };
    const first = evaluatePredicate(context, predicate);
    const second = evaluatePredicate(context, predicate);
    expect(first).toBe(second);
    expect(first).toBe(true);
  });
});
