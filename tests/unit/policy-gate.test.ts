import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import type {
  PolicyRecord,
  PolicyRule,
  IntentEvaluationContext,
  PolicyGateWarning,
  PolicyTraceEntry,
} from "../../app/src/server/policy/types";
import {
  deduplicatePolicies,
  collectAndSortRules,
  evaluateRulesAgainstContext,
  buildGateResult,
} from "../../app/src/server/policy/policy-gate";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const makePolicyRecord = (
  id: string,
  rules: PolicyRule[],
  overrides?: Partial<PolicyRecord>,
): PolicyRecord => ({
  id: new RecordId("policy", id),
  title: `Policy ${id}`,
  version: 1,
  status: "active",
  selector: {},
  rules,
  human_veto_required: false,
  created_by: new RecordId("identity", "creator-1"),
  workspace: new RecordId("workspace", "ws-1"),
  created_at: new Date("2026-01-01"),
  ...overrides,
});

const makeContext = (
  overrides?: Partial<IntentEvaluationContext>,
): IntentEvaluationContext => ({
  goal: "Test goal",
  reasoning: "Test reasoning",
  priority: 50,
  action_spec: { provider: "test", action: "read", params: {} },
  requester_type: "agent",
  ...overrides,
});

// ---------------------------------------------------------------------------
// deduplicatePolicies
// ---------------------------------------------------------------------------

describe("deduplicatePolicies", () => {
  it("removes duplicate policies by ID", () => {
    const policy = makePolicyRecord("p1", []);
    const duplicate = makePolicyRecord("p1", []);

    const result = deduplicatePolicies([policy, duplicate]);

    expect(result).toHaveLength(1);
    expect((result[0].id.id as string)).toBe("p1");
  });

  it("preserves unique policies", () => {
    const p1 = makePolicyRecord("p1", []);
    const p2 = makePolicyRecord("p2", []);

    const result = deduplicatePolicies([p1, p2]);

    expect(result).toHaveLength(2);
  });

  it("handles empty array", () => {
    const result = deduplicatePolicies([]);

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectAndSortRules
// ---------------------------------------------------------------------------

describe("collectAndSortRules", () => {
  it("merges rules from multiple policies", () => {
    const p1 = makePolicyRecord("p1", [
      { id: "r1", condition: { field: "a", operator: "eq", value: "x" }, effect: "allow", priority: 10 },
    ]);
    const p2 = makePolicyRecord("p2", [
      { id: "r2", condition: { field: "b", operator: "eq", value: "y" }, effect: "deny", priority: 50 },
    ]);

    const result = collectAndSortRules([p1, p2]);

    expect(result).toHaveLength(2);
  });

  it("sorts by priority DESC (highest first)", () => {
    const policy = makePolicyRecord("p1", [
      { id: "low", condition: { field: "a", operator: "eq", value: "x" }, effect: "allow", priority: 10 },
      { id: "high", condition: { field: "b", operator: "eq", value: "y" }, effect: "deny", priority: 100 },
      { id: "mid", condition: { field: "c", operator: "eq", value: "z" }, effect: "allow", priority: 50 },
    ]);

    const result = collectAndSortRules([policy]);

    expect(result[0].rule.id).toBe("high");
    expect(result[1].rule.id).toBe("mid");
    expect(result[2].rule.id).toBe("low");
  });

  it("attaches policy metadata to each rule", () => {
    const policy = makePolicyRecord("p1", [
      { id: "r1", condition: { field: "a", operator: "eq", value: "x" }, effect: "allow", priority: 10 },
    ], { version: 3, human_veto_required: true });

    const result = collectAndSortRules([policy]);

    expect(result[0].policyId).toBe("p1");
    expect(result[0].policyVersion).toBe(3);
    expect(result[0].humanVetoRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateRulesAgainstContext
// ---------------------------------------------------------------------------

describe("evaluateRulesAgainstContext", () => {
  it("evaluates all rules when no deny matches", () => {
    const context = makeContext({
      action_spec: { provider: "test", action: "read", params: {} },
    });
    const rules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "allow_read",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "read" },
          effect: "allow" as const,
          priority: 10,
        },
      },
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "deny_deploy",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "deploy" },
          effect: "deny" as const,
          priority: 5,
        },
      },
    ];

    const result = evaluateRulesAgainstContext(rules, context);

    // Both rules evaluated (deny didn't match so no short-circuit)
    expect(result.evaluatedRules).toHaveLength(2);
    expect(result.denyMatched).toBe(false);
  });

  it("short-circuits on first deny match (subsequent rules not evaluated)", () => {
    const context = makeContext({
      action_spec: { provider: "infra", action: "deploy", params: {} },
    });
    const rules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "block_deploy",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "deploy" },
          effect: "deny" as const,
          priority: 100,
        },
      },
      {
        policyId: "p2",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "allow_read",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "read" },
          effect: "allow" as const,
          priority: 10,
        },
      },
    ];

    const result = evaluateRulesAgainstContext(rules, context);

    // Only first rule evaluated due to deny short-circuit
    expect(result.evaluatedRules).toHaveLength(1);
    expect(result.evaluatedRules[0].matched).toBe(true);
    expect(result.evaluatedRules[0].rule.effect).toBe("deny");
    expect(result.denyMatched).toBe(true);
  });

  it("collects warnings for missing fields", () => {
    const context = makeContext(); // no budget_limit field
    const rules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "budget_check",
          condition: { field: "budget_limit.amount", operator: "lte" as const, value: 1000 },
          effect: "deny" as const,
          priority: 50,
        },
      },
    ];

    const result = evaluateRulesAgainstContext(rules, context);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].field).toBe("budget_limit.amount");
    expect(result.warnings[0].rule_id).toBe("budget_check");
    expect(result.warnings[0].policy_id).toBe("p1");
    // Missing field means predicate doesn't match, so deny doesn't trigger
    expect(result.denyMatched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildGateResult
// ---------------------------------------------------------------------------

describe("buildGateResult", () => {
  it("returns passed=true for empty evaluated rules", () => {
    const result = buildGateResult([], false, []);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.policy_trace).toHaveLength(0);
      expect(result.human_veto_required).toBe(false);
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("returns passed=false with deny_rule_id on deny match", () => {
    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "block_deploy",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "deploy" },
          effect: "deny" as const,
          priority: 100,
        },
        matched: true,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const result = buildGateResult(evaluatedRules, true, []);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.deny_rule_id).toBe("block_deploy");
      expect(result.reason).toContain("block_deploy");
    }
  });

  it("sets human_veto_required when any policy requires it", () => {
    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: true,
        rule: {
          id: "r1",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "pay" },
          effect: "allow" as const,
          priority: 10,
        },
        matched: true,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const result = buildGateResult(evaluatedRules, false, []);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.human_veto_required).toBe(true);
    }
  });

  it("builds correct PolicyTraceEntry array", () => {
    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 2,
        humanVetoRequired: false,
        rule: {
          id: "r1",
          condition: { field: "a", operator: "eq" as const, value: "x" },
          effect: "allow" as const,
          priority: 50,
        },
        matched: true,
        warnings: [] as PolicyGateWarning[],
      },
      {
        policyId: "p2",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "r2",
          condition: { field: "b", operator: "eq" as const, value: "y" },
          effect: "deny" as const,
          priority: 10,
        },
        matched: false,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const result = buildGateResult(evaluatedRules, false, []);

    expect(result.policy_trace).toHaveLength(2);
    expect(result.policy_trace[0]).toEqual({
      policy_id: "p1",
      policy_version: 2,
      rule_id: "r1",
      effect: "allow",
      matched: true,
      priority: 50,
    });
    expect(result.policy_trace[1]).toEqual({
      policy_id: "p2",
      policy_version: 1,
      rule_id: "r2",
      effect: "deny",
      matched: false,
      priority: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// extractEvidenceRequirements
// ---------------------------------------------------------------------------

describe("extractEvidenceRequirements", () => {
  it("extracts evidence requirements from matched evidence_requirement rules", async () => {
    const { extractEvidenceRequirements } = await import(
      "../../app/src/server/policy/policy-gate"
    );

    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "financial-evidence-req",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "financial_transaction" },
          effect: "evidence_requirement" as const,
          priority: 100,
          min_evidence_count: 4,
          required_types: ["decision", "task"],
        },
        matched: true,
        warnings: [],
      },
    ];

    const result = extractEvidenceRequirements(evaluatedRules);

    expect(result).toBeDefined();
    expect(result!.min_count).toBe(4);
    expect(result!.required_types).toEqual(["decision", "task"]);
  });

  it("returns undefined when no evidence_requirement rules match", async () => {
    const { extractEvidenceRequirements } = await import(
      "../../app/src/server/policy/policy-gate"
    );

    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "allow-read",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "read" },
          effect: "allow" as const,
          priority: 10,
        },
        matched: true,
        warnings: [],
      },
    ];

    const result = extractEvidenceRequirements(evaluatedRules);

    expect(result).toBeUndefined();
  });

  it("uses the highest-priority matched evidence_requirement rule", async () => {
    const { extractEvidenceRequirements } = await import(
      "../../app/src/server/policy/policy-gate"
    );

    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "strict-req",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "financial_transaction" },
          effect: "evidence_requirement" as const,
          priority: 200,
          min_evidence_count: 6,
        },
        matched: true,
        warnings: [],
      },
      {
        policyId: "p2",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "relaxed-req",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "financial_transaction" },
          effect: "evidence_requirement" as const,
          priority: 50,
          min_evidence_count: 2,
        },
        matched: true,
        warnings: [],
      },
    ];

    // Rules are already sorted by priority DESC, so first match wins
    const result = extractEvidenceRequirements(evaluatedRules);

    expect(result).toBeDefined();
    expect(result!.min_count).toBe(6);
  });

  it("ignores unmatched evidence_requirement rules", async () => {
    const { extractEvidenceRequirements } = await import(
      "../../app/src/server/policy/policy-gate"
    );

    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "financial-evidence-req",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "financial_transaction" },
          effect: "evidence_requirement" as const,
          priority: 100,
          min_evidence_count: 4,
        },
        matched: false,
        warnings: [],
      },
    ];

    const result = extractEvidenceRequirements(evaluatedRules);

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildGateResult with evidence requirements
// ---------------------------------------------------------------------------

describe("buildGateResult with evidence requirements", () => {
  it("includes evidence_requirements on passed result", () => {
    const evaluatedRules = [
      {
        policyId: "p1",
        policyVersion: 1,
        humanVetoRequired: false,
        rule: {
          id: "r1",
          condition: { field: "action_spec.action", operator: "eq" as const, value: "pay" },
          effect: "allow" as const,
          priority: 10,
        },
        matched: true,
        warnings: [] as PolicyGateWarning[],
      },
    ];

    const evidenceRequirements = { min_count: 4, required_types: ["decision", "task"] };
    const result = buildGateResult(evaluatedRules, false, [], evidenceRequirements);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence_requirements).toEqual({
        min_count: 4,
        required_types: ["decision", "task"],
      });
    }
  });

  it("omits evidence_requirements when none matched", () => {
    const result = buildGateResult([], false, []);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence_requirements).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// evaluatePolicyGate integration (mocked IO boundary)
// ---------------------------------------------------------------------------

describe("evaluatePolicyGate integration", () => {
  it("empty policy set returns passed with empty trace", async () => {
    // We test the full pipeline by importing evaluatePolicyGate and
    // providing a mock surreal that returns empty policies.
    const { evaluatePolicyGate } = await import(
      "../../app/src/server/policy/policy-gate"
    );

    const mockSurreal = {
      query: async () => [{ policies: [] }],
    } as any;

    const result = await evaluatePolicyGate(
      mockSurreal,
      new RecordId("identity", "test-id"),
      new RecordId("workspace", "test-ws"),
      makeContext(),
    );

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.policy_trace).toHaveLength(0);
      expect(result.human_veto_required).toBe(false);
      expect(result.warnings).toHaveLength(0);
    }
  });
});
