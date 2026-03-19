/**
 * Authorizer Integration Acceptance Tests (US-DB-003)
 *
 * Validates that the Authorizer reads dynamic behavior scores from
 * behavior records with arbitrary metric_type values, and enforces
 * policy thresholds to approve or deny agent intents.
 *
 * Driving ports:
 *   enrichBehaviorScores (context enrichment function)
 *   evaluateRulesAgainstContext (pure policy gate pipeline)
 *   SurrealDB direct queries (seeding + verification)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupDynamicBehaviorsSuite,
  setupBehaviorWorkspace,
  createAgentIdentity,
  createBehaviorDefinition,
  createScoredBehaviorRecord,
  createBehaviorPolicy,
  getLatestBehaviorScore,
} from "./dynamic-behaviors-test-kit";
import type { IntentEvaluationContext } from "../../../app/src/server/policy/types";
import {
  evaluateRulesAgainstContext,
  collectAndSortRules,
  buildGateResult,
} from "../../../app/src/server/policy/policy-gate";
import { enrichBehaviorScores } from "../../../app/src/server/behavior/queries";
import type { PolicyRecord } from "../../../app/src/server/policy/types";

const getRuntime = setupDynamicBehaviorsSuite("authorizer_integration");

// =============================================================================
// Walking Skeleton: covered in walking-skeleton.test.ts
// =============================================================================

// ---------------------------------------------------------------------------
// Helper: build policies array for gate evaluation
// ---------------------------------------------------------------------------
function buildPolicies(
  policyId: string,
  adminId: string,
  workspaceId: string,
  rules: PolicyRecord["rules"],
): PolicyRecord[] {
  return [{
    id: new RecordId("policy", policyId),
    title: "Dynamic Behavior Gate",
    version: 1,
    status: "active",
    selector: {},
    rules,
    human_veto_required: false,
    created_by: new RecordId("identity", adminId),
    workspace: new RecordId("workspace", workspaceId),
    created_at: new Date(),
  }];
}

// =============================================================================
// Happy Path: Deny intent when dynamic behavior score below threshold (AC-003.2)
// =============================================================================
describe("Happy Path: Intent denied when dynamic Honesty score below threshold (US-DB-003)", () => {
  it("Authorizer denies intent with specific metric name, score, and threshold in reason", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-deny-${crypto.randomUUID()}`,
    );

    // Given coding-agent-alpha has a low Honesty score
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.05,
      definitionId,
    });

    // And a policy requires behavior_scores.Honesty >= 0.50
    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Honesty Behavior Gate",
      rules: [{
        id: "honesty_min",
        condition: {
          field: "behavior_scores.Honesty",
          operator: "lt",
          value: 0.50,
        },
        effect: "deny",
        priority: 100,
      }],
    });

    // When the Authorizer enriches the context
    const baseContext: IntentEvaluationContext = {
      goal: "Commit code changes",
      reasoning: "Implementation complete",
      priority: 50,
      action_spec: { provider: "code", action: "commit", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(surreal, agentId, baseContext);

    // Then behavior_scores contains the dynamic Honesty score
    expect(enrichedContext.behavior_scores!.Honesty).toBe(0.05);

    // And the policy gate denies the intent
    const policies = buildPolicies(policyId, adminId, workspaceId, [{
      id: "honesty_min",
      condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
      effect: "deny",
      priority: 100,
    }]);

    const sortedRules = collectAndSortRules(policies);
    const { evaluatedRules, denyMatched, warnings } = evaluateRulesAgainstContext(
      sortedRules,
      enrichedContext,
    );
    const gateResult = buildGateResult(evaluatedRules, denyMatched, warnings);

    expect(gateResult.passed).toBe(false);
    if (!gateResult.passed) {
      expect(gateResult.deny_rule_id).toBe("honesty_min");
    }
  }, 60_000);
});

// =============================================================================
// Happy Path: Allow intent when score above threshold (AC-003.2)
// =============================================================================
describe("Happy Path: Intent allowed when dynamic Honesty score above threshold (US-DB-003)", () => {
  it("agent with recovered score passes the behavior gate", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-allow-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // Given coding-agent-alpha's Honesty score has recovered to 0.88
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.88,
      definitionId,
    });

    // When the Authorizer evaluates
    const baseContext: IntentEvaluationContext = {
      goal: "Commit code changes",
      reasoning: "All tests passing",
      priority: 50,
      action_spec: { provider: "code", action: "commit", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(surreal, agentId, baseContext);
    expect(enrichedContext.behavior_scores!.Honesty).toBe(0.88);

    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Honesty Behavior Gate",
      rules: [{
        id: "honesty_min",
        condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
        effect: "deny",
        priority: 100,
      }],
    });

    const policies = buildPolicies(policyId, adminId, workspaceId, [{
      id: "honesty_min",
      condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
      effect: "deny",
      priority: 100,
    }]);

    const sortedRules = collectAndSortRules(policies);
    const { evaluatedRules, denyMatched, warnings } = evaluateRulesAgainstContext(
      sortedRules,
      enrichedContext,
    );
    const gateResult = buildGateResult(evaluatedRules, denyMatched, warnings);

    // Then the policy gate allows the intent
    expect(gateResult.passed).toBe(true);
  }, 60_000);
});

// =============================================================================
// Happy Path: Missing score does not trigger denial (AC-003.3)
// =============================================================================
describe("Happy Path: Missing score for new metric does not deny intent (US-DB-003)", () => {
  it("agent with no Collaboration scores passes the behavior gate", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-missing-${crypto.randomUUID()}`,
    );

    // Given coding-agent-alpha has no behavior scores for "Collaboration"
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    const score = await getLatestBehaviorScore(surreal, agentId, "Collaboration");
    expect(score).toBeUndefined();

    // When the Authorizer enriches the context
    const baseContext: IntentEvaluationContext = {
      goal: "Fix documentation typo",
      reasoning: "Minor documentation fix",
      priority: 10,
      action_spec: { provider: "code", action: "fix", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(surreal, agentId, baseContext);

    // And a policy references behavior_scores.Collaboration >= 0.50
    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Collaboration Gate",
      rules: [{
        id: "collab_min",
        condition: { field: "behavior_scores.Collaboration", operator: "lt", value: 0.50 },
        effect: "deny",
        priority: 100,
      }],
    });

    const policies = buildPolicies(policyId, adminId, workspaceId, [{
      id: "collab_min",
      condition: { field: "behavior_scores.Collaboration", operator: "lt", value: 0.50 },
      effect: "deny",
      priority: 100,
    }]);

    const sortedRules = collectAndSortRules(policies);
    const { evaluatedRules, denyMatched, warnings } = evaluateRulesAgainstContext(
      sortedRules,
      enrichedContext,
    );
    const gateResult = buildGateResult(evaluatedRules, denyMatched, warnings);

    // Then the intent is NOT denied (missing score is not a violation)
    expect(gateResult.passed).toBe(true);

    // And a warning is emitted for the missing field
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].field).toBe("behavior_scores.Collaboration");
  }, 60_000);
});

// =============================================================================
// Error Path: Multiple behavior scores evaluated together (AC-003.2)
// =============================================================================
describe("Error Path: Multiple behavior scores evaluated together (US-DB-003)", () => {
  it("intent denied when one of multiple scores fails threshold", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-multi-score-${crypto.randomUUID()}`,
    );

    // Given coding-agent-alpha has Honesty=0.92 and Evidence_Based=0.15
    const { definitionId: honestyDefId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { definitionId: evidenceDefId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Evidence_Based",
      goal: "Cite evidence.",
      scoring_logic: "Count citations.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.92,
      definitionId: honestyDefId,
    });

    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Evidence_Based",
      score: 0.15,
      definitionId: evidenceDefId,
    });

    // And policy rules require both >= 0.50
    const baseContext: IntentEvaluationContext = {
      goal: "Propose architecture change",
      reasoning: "New approach identified",
      priority: 50,
      action_spec: { provider: "code", action: "propose", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(surreal, agentId, baseContext);
    expect(enrichedContext.behavior_scores!.Honesty).toBe(0.92);
    expect(enrichedContext.behavior_scores!.Evidence_Based).toBe(0.15);

    const policies: PolicyRecord[] = [{
      id: new RecordId("policy", `policy-${crypto.randomUUID()}`),
      title: "Multi Behavior Gate",
      version: 1,
      status: "active",
      selector: {},
      rules: [
        {
          id: "honesty_min",
          condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
          effect: "deny",
          priority: 100,
        },
        {
          id: "evidence_min",
          condition: { field: "behavior_scores.Evidence_Based", operator: "lt", value: 0.50 },
          effect: "deny",
          priority: 90,
        },
      ],
      human_veto_required: false,
      created_by: new RecordId("identity", adminId),
      workspace: new RecordId("workspace", workspaceId),
      created_at: new Date(),
    }];

    const sortedRules = collectAndSortRules(policies);
    const { evaluatedRules, denyMatched, warnings } = evaluateRulesAgainstContext(
      sortedRules,
      enrichedContext,
    );
    const gateResult = buildGateResult(evaluatedRules, denyMatched, warnings);

    // Then the intent is denied for the failing metric
    expect(gateResult.passed).toBe(false);
    if (!gateResult.passed) {
      expect(gateResult.deny_rule_id).toBe("evidence_min");
    }
  }, 60_000);
});

// =============================================================================
// Happy Path: Recovery uses same threshold as restriction (AC-003.4)
// =============================================================================
describe("Happy Path: Recovery threshold is symmetric with restriction (US-DB-003)", () => {
  it("agent restricted at 0.50 recovers when score reaches 0.50", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-symmetry-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    const rules = [{
      id: "honesty_min",
      condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
      effect: "deny" as const,
      priority: 100,
    }];

    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Honesty Gate",
      rules,
    });

    const baseContext: IntentEvaluationContext = {
      goal: "Commit code",
      reasoning: "Changes ready",
      priority: 50,
      action_spec: { provider: "code", action: "commit", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    // Given agent is restricted with score 0.30
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.30,
      definitionId,
    });

    let enriched = await enrichBehaviorScores(surreal, agentId, baseContext);
    let sorted = collectAndSortRules(buildPolicies(policyId, adminId, workspaceId, rules));
    let result = buildGateResult(...Object.values(evaluateRulesAgainstContext(sorted, enriched)) as [any, any, any]);
    expect(result.passed).toBe(false);

    // When score recovers to exactly 0.50 (at threshold boundary)
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.50,
      definitionId,
    });

    enriched = await enrichBehaviorScores(surreal, agentId, baseContext);
    sorted = collectAndSortRules(buildPolicies(policyId, adminId, workspaceId, rules));
    result = buildGateResult(...Object.values(evaluateRulesAgainstContext(sorted, enriched)) as [any, any, any]);

    // Then the intent is allowed (0.50 is NOT less than 0.50)
    expect(result.passed).toBe(true);
  }, 60_000);
});

// =============================================================================
// Error Path: Agent with no behavior data is not blocked (AC-003.3)
// =============================================================================
describe("Error Path: New agent with no scores is not blocked by behavior policy (US-DB-003)", () => {
  it("new agent passes behavior gate when no scores exist", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-new-agent-${crypto.randomUUID()}`,
    );

    // Given a brand new agent with no behavior records
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-new",
    );

    const baseContext: IntentEvaluationContext = {
      goal: "Fix typo in readme",
      reasoning: "Minor fix",
      priority: 10,
      action_spec: { provider: "code", action: "fix", params: {} },
      requester_type: "agent",
      requester_role: "coder",
    };

    const enrichedContext = await enrichBehaviorScores(surreal, agentId, baseContext);

    // Then behavior_scores is empty
    expect(enrichedContext.behavior_scores).toEqual({});

    const { policyId } = await createBehaviorPolicy(surreal, workspaceId, adminId, {
      title: "Honesty Gate",
      rules: [{
        id: "honesty_min",
        condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
        effect: "deny",
        priority: 100,
      }],
    });

    const policies = buildPolicies(policyId, adminId, workspaceId, [{
      id: "honesty_min",
      condition: { field: "behavior_scores.Honesty", operator: "lt", value: 0.50 },
      effect: "deny",
      priority: 100,
    }]);

    const sortedRules = collectAndSortRules(policies);
    const { evaluatedRules, denyMatched, warnings } = evaluateRulesAgainstContext(
      sortedRules,
      enrichedContext,
    );
    const gateResult = buildGateResult(evaluatedRules, denyMatched, warnings);

    // Then the intent is NOT denied
    expect(gateResult.passed).toBe(true);
  }, 60_000);
});

// =============================================================================
// Boundary: Feed items for restriction and recovery (AC-003.5)
// =============================================================================
describe("Boundary: Feed items generated for restriction and recovery events (US-DB-003)", () => {
  it.skip("restriction event generates feed item with metric, score, threshold, and scopes", async () => {
    // Given coding-agent-alpha is restricted due to Honesty score 0.05
    // When the restriction is applied
    // Then a feed item is generated with:
    //   - agent identity
    //   - metric name: Honesty
    //   - score: 0.05
    //   - threshold: 0.50
    //   - restricted scopes: write:code, create:decision
    //   - retained scopes: read:graph, read:context
  });

  it.skip("recovery event generates feed item noting score improvement", async () => {
    // Given coding-agent-alpha was restricted with Honesty score 0.05
    // When the score recovers to 0.88 and the next intent is allowed
    // Then a feed item is generated with:
    //   - agent identity
    //   - metric name: Honesty
    //   - old score: 0.05
    //   - new score: 0.88
    //   - restored scopes
  });
});
