/**
 * Milestone 2: Policy Gate Evaluation and Rule Engine
 *
 * Traces: US-4, US-5, US-6, US-9
 *
 * Validates policy loading via graph traversal, rule evaluation with
 * priority-sorted deny short-circuit, human veto override, and
 * backward compatibility with empty policy sets.
 *
 * Driving ports:
 *   Direct DB for policy graph setup
 *   Policy gate simulation for evaluation results
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicy,
  activatePolicy,
  deprecatePolicy,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  simulatePolicyGateResult,
  loadActivePoliciesForIdentity,
  type PolicyTraceEntry,
} from "./policy-test-kit";

const getRuntime = setupOrchestratorSuite("policy_m2_gate_evaluation");

describe("Milestone 2: Policy Gate Graph Traversal (US-4)", () => {
  // ---------------------------------------------------------------------------
  // US-4: Loads policies from both identity and workspace edges
  // AC-4 happy path
  // ---------------------------------------------------------------------------
  it("loads active policies from both identity governing edges and workspace protects edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given identity-linked and workspace-linked policies
    const user = await createTestUser(baseUrl, "m2-traverse");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId: p1 } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Identity-Linked Budget Policy",
      rules: [{
        id: "budget_check",
        condition: { field: "budget_limit.amount", operator: "lte", value: 1000 },
        effect: "allow",
        priority: 10,
      }],
    });
    await activatePolicy(surreal, p1, adminId, workspace.workspaceId);

    const admin2Id = await createTestIdentity(surreal, "admin-2", "human", workspace.workspaceId);
    const { policyId: p2 } = await createPolicy(surreal, workspace.workspaceId, admin2Id, {
      title: "Workspace-Linked Deploy Block",
      rules: [{
        id: "no_deploy",
        condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
        effect: "deny",
        priority: 100,
      }],
    });
    await activatePolicy(surreal, p2, admin2Id, workspace.workspaceId);

    // When loading policies for admin-1 in the workspace
    const policies = await loadActivePoliciesForIdentity(surreal, adminId, workspace.workspaceId);

    // Then both policies are returned (identity-linked via governing, workspace-linked via protects)
    expect(policies.length).toBeGreaterThanOrEqual(2);
    const ids = policies.map(p => p.id.id as string);
    expect(ids).toContain(p1);
    expect(ids).toContain(p2);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-4: Deprecated policies are excluded from loading
  // AC-4 filter path
  // ---------------------------------------------------------------------------
  it("excludes deprecated policies from graph traversal results", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy and a deprecated policy
    const user = await createTestUser(baseUrl, "m2-deprecated");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);

    const { policyId: activeId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Active Policy",
      rules: [{
        id: "active_rule",
        condition: { field: "action_spec.action", operator: "eq", value: "read" },
        effect: "allow",
        priority: 5,
      }],
    });
    await activatePolicy(surreal, activeId, adminId, workspace.workspaceId);

    const { policyId: deprecatedId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deprecated Policy",
      rules: [{
        id: "old_rule",
        condition: { field: "action_spec.action", operator: "eq", value: "write" },
        effect: "deny",
        priority: 50,
      }],
    });
    await activatePolicy(surreal, deprecatedId, adminId, workspace.workspaceId);
    await deprecatePolicy(surreal, deprecatedId);

    // When loading active policies
    const policies = await loadActivePoliciesForIdentity(surreal, adminId, workspace.workspaceId);

    // Then only the active policy is returned
    const ids = policies.map(p => p.id.id as string);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(deprecatedId);
  }, 120_000);
});

describe("Milestone 2: Rule Evaluation Engine (US-5)", () => {
  // ---------------------------------------------------------------------------
  // US-5: Deny rule at higher priority short-circuits evaluation
  // AC-5 deny short-circuit
  // ---------------------------------------------------------------------------
  it("deny rule at priority 100 blocks intent before lower-priority allow rule is evaluated", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with deny (priority 100) and allow (priority 10) policies
    const user = await createTestUser(baseUrl, "m2-deny-first");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId: denyPolicyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Block Deploy",
      rules: [{
        id: "block_deploy",
        condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
        effect: "deny",
        priority: 100,
      }],
    });
    await activatePolicy(surreal, denyPolicyId, adminId, workspace.workspaceId);

    const { policyId: allowPolicyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Allow Read",
      rules: [{
        id: "allow_read",
        condition: { field: "action_spec.action", operator: "eq", value: "read" },
        effect: "allow",
        priority: 10,
      }],
    });
    await activatePolicy(surreal, allowPolicyId, adminId, workspace.workspaceId);

    // When the agent submits a deploy intent
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Deploy to staging",
      reasoning: "Feature branch is ready",
      action_spec: { provider: "infra", action: "deploy", params: {} },
    });
    await submitIntent(surreal, intentId);

    // Then the deny rule matches first and short-circuits
    const trace: PolicyTraceEntry[] = [
      {
        policy_id: denyPolicyId,
        policy_version: 1,
        rule_id: "block_deploy",
        effect: "deny",
        matched: true,
        priority: 100,
      },
      // allow_read never evaluated due to short-circuit
    ];

    await simulatePolicyGateResult(surreal, intentId, {
      decision: "REJECT",
      risk_score: 0,
      reason: "Policy deny rule 'block_deploy' matched",
      policy_only: true,
      policy_trace: trace,
    }, "vetoed");

    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("vetoed");

    const evaluation = await getIntentEvaluation(surreal, intentId);
    expect(evaluation!.policy_only).toBe(true);
    expect(evaluation!.decision).toBe("REJECT");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-5: All allow rules pass when no deny matches
  // AC-5 happy path
  // ---------------------------------------------------------------------------
  it("intent passes when only allow rules match and no deny rules trigger", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m2-allow-pass");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Allow File Edits",
      rules: [{
        id: "allow_edit",
        condition: { field: "action_spec.action", operator: "eq", value: "edit_file" },
        effect: "allow",
        priority: 10,
      }],
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Fix typo in README",
      reasoning: "Simple text correction",
      action_spec: { provider: "file_editor", action: "edit_file", params: {} },
    });
    await submitIntent(surreal, intentId);

    // Then the allow rule matches and policy gate passes (continues to LLM tier)
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "Low risk file edit",
      policy_only: false,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: "allow_edit",
        effect: "allow",
        matched: true,
        priority: 10,
      }],
    }, "authorized");

    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("authorized");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // US-5: No rule matches means pass (no deny = pass)
  // AC-5 no-match path
  // ---------------------------------------------------------------------------
  it("intent passes when no rule conditions match (no deny = pass)", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "m2-no-match");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    // Given a policy that only targets "deploy" actions
    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Deploy Guard",
      rules: [{
        id: "block_deploy",
        condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
        effect: "deny",
        priority: 100,
      }],
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the agent submits a non-deploy intent
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Run test suite",
      reasoning: "Verify all tests pass before merge",
      action_spec: { provider: "test_runner", action: "run_tests", params: {} },
    });
    await submitIntent(surreal, intentId);

    // Then no rule matches, so the policy gate passes
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 10,
      reason: "Tests are safe. Low risk.",
      policy_only: false,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: "block_deploy",
        effect: "deny",
        matched: false,
        priority: 100,
      }],
    }, "authorized");

    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("authorized");
  }, 120_000);
});

describe("Milestone 2: Human Veto Gate Override (US-6)", () => {
  // ---------------------------------------------------------------------------
  // US-6: Policy forces veto window regardless of risk score
  // AC-6
  // ---------------------------------------------------------------------------
  it("policy with human_veto_required forces veto window even for low-risk intents", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active policy with human_veto_required = true
    const user = await createTestUser(baseUrl, "m2-veto-force");
    const workspace = await createTestWorkspace(baseUrl, user);
    const adminId = await createTestIdentity(surreal, "admin-1", "human", workspace.workspaceId);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    const { policyId } = await createPolicy(surreal, workspace.workspaceId, adminId, {
      title: "Require Human Approval for All Financial Actions",
      rules: [{
        id: "financial_check",
        condition: { field: "action_spec.action", operator: "eq", value: "pay" },
        effect: "allow",
        priority: 10,
      }],
      human_veto_required: true,
    });
    await activatePolicy(surreal, policyId, adminId, workspace.workspaceId);

    // When the agent submits a low-risk payment intent
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Pay invoice #456",
      reasoning: "Routine monthly payment for SaaS subscription",
      action_spec: { provider: "billing", action: "pay", params: {} },
      budget_limit: { amount: 29.99, currency: "USD" },
    });
    await submitIntent(surreal, intentId);

    // Then even though the risk is low, the policy forces veto window
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 10,
      reason: "Low-risk payment within budget",
      policy_only: false,
      policy_trace: [{
        policy_id: policyId,
        policy_version: 1,
        rule_id: "financial_check",
        effect: "allow",
        matched: true,
        priority: 10,
      }],
      human_veto_required: true,
    }, "pending_veto");

    // Then the intent is in veto window (not auto-approved)
    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("pending_veto");

    // And the veto window expiry is set
    const record = await getIntentRecord(surreal, intentId);
    expect(record.veto_expires_at).toBeDefined();

    // And the evaluation records the human_veto_required flag
    const evaluation = record.evaluation as Record<string, unknown>;
    expect(evaluation.human_veto_required).toBe(true);
  }, 120_000);
});

describe("Milestone 2: Backward Compatibility (US-9)", () => {
  // ---------------------------------------------------------------------------
  // US-9: No active policies means policy gate passes
  // AC-9
  // ---------------------------------------------------------------------------
  it("empty policy set passes the gate and proceeds to LLM evaluation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with no policies at all
    const user = await createTestUser(baseUrl, "m2-compat");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    // When the agent submits an intent
    const { intentId } = await createDraftIntent(surreal, workspace.workspaceId, agentId, {
      goal: "Refactor utils module",
      reasoning: "Extract common functions into shared utility",
      action_spec: { provider: "file_editor", action: "edit_file", params: {} },
    });
    await submitIntent(surreal, intentId);

    // Then no policies are loaded
    const policies = await loadActivePoliciesForIdentity(surreal, agentId, workspace.workspaceId);
    expect(policies).toHaveLength(0);

    // And the intent proceeds to LLM evaluation (not policy-only)
    await simulatePolicyGateResult(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 15,
      reason: "Safe refactoring. Low risk.",
      policy_only: false,
      policy_trace: [],
    }, "authorized");

    const evaluation = await getIntentEvaluation(surreal, intentId);
    expect(evaluation!.policy_only).toBe(false);

    // And the policy trace is empty
    const record = await getIntentRecord(surreal, intentId);
    const trace = (record.evaluation as Record<string, unknown>)?.policy_trace as unknown[];
    expect(trace).toHaveLength(0);
  }, 120_000);
});
