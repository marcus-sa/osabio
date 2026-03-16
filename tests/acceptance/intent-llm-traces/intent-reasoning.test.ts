/**
 * Step 02: Intent LLM Reasoning Persistence
 *
 * Traces: US-02 (Persist LLM Reasoning on Intents)
 *
 * Validates that:
 * - Intent evaluation captures LLM chain-of-thought as llm_reasoning
 * - llm_reasoning is distinct from the human-authored reasoning field
 * - Policy-only evaluations have no llm_reasoning (field absent)
 * - llm_reasoning persists through intent status transitions
 *
 * Driving ports:
 *   updateIntentStatus() — intent query function (app/src/server/intent/intent-queries.ts)
 *   evaluateIntent()     — authorizer pipeline (app/src/server/intent/authorizer.ts)
 *   Direct DB for schema validation
 *
 * Error path ratio: 5/12 = 42%
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupReasoningSuite,
  setupReasoningWorkspace,
  createDraftIntent,
  simulateEvaluationWithReasoning,
  simulatePolicyOnlyEvaluation,
  getIntentRecord,
} from "./reasoning-test-kit";

const getRuntime = setupReasoningSuite("intent_reasoning_step02");

// =============================================================================
// Walking Skeleton: Authorizer captures its reasoning when evaluating an intent
// =============================================================================

describe("Walking Skeleton: Authorizer records its reasoning during intent evaluation", () => {
  // @walking_skeleton
  it("agent submits intent for authorization and the evaluator's reasoning is captured alongside the decision", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent has declared an intent to edit a file
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "ws-skel-intent");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Add input validation to the signup form",
      reasoning: "The task requires email format validation for security compliance",
      action_spec: { provider: "file_editor", action: "edit_file", params: { target: "src/components/SignupForm.tsx" } },
    });

    // When the authorizer evaluates the intent using LLM analysis
    const llmReasoning = [
      "Analyzing intent: edit_file on src/components/SignupForm.tsx.",
      "The goal (input validation) is well-scoped to a single component.",
      "The file is in the UI layer, not infrastructure. Low blast radius.",
      "No budget implications. The reasoning aligns with the stated task.",
      "Risk assessment: minimal. Approving with low risk score.",
    ].join(" ");

    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 15,
      reason: "Low-risk file edit scoped to UI component",
      llm_reasoning: llmReasoning,
      resultStatus: "authorized",
    });

    // Then the intent carries both the human reasoning and the evaluator's reasoning
    const record = await getIntentRecord(surreal, intentId);
    expect(record.reasoning).toBe("The task requires email format validation for security compliance");
    expect(record.llm_reasoning).toBe(llmReasoning);
    expect(record.evaluation?.decision).toBe("APPROVE");
    expect(record.status).toBe("authorized");
  }, 30_000);
});

// =============================================================================
// Happy Path: LLM reasoning captured across evaluation outcomes
// =============================================================================

describe("Step 02: LLM reasoning persists across evaluation outcomes", () => {
  // ---------------------------------------------------------------------------
  // S02-1: Approved intent with LLM reasoning
  // ---------------------------------------------------------------------------
  it("approved intent stores the evaluator's reasoning explaining why it is safe", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent declares a low-risk intent
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-approve");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Read project configuration",
      reasoning: "Need to check current project settings before making changes",
      action_spec: { provider: "file_reader", action: "read_file" },
    });

    // When the evaluator approves with its reasoning
    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "Read-only operation with minimal risk",
      llm_reasoning: "The intent requests read-only access to configuration. No write operations, no external API calls, no budget impact. This is the lowest-risk category of file operations.",
      resultStatus: "authorized",
    });

    // Then the LLM reasoning is persisted on the intent
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toContain("read-only access");
    expect(record.evaluation?.policy_only).toBe(false);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-2: Rejected intent with LLM reasoning
  // ---------------------------------------------------------------------------
  it("rejected intent stores the evaluator's reasoning explaining why it was denied", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent declares a high-risk intent
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-reject");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Delete all user data from production database",
      reasoning: "Cleaning up test data that was accidentally written to production",
      action_spec: { provider: "database", action: "delete_all", params: { table: "users", env: "production" } },
    });

    // When the evaluator rejects with its reasoning
    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "REJECT",
      risk_score: 98,
      reason: "Destructive operation on production data exceeds agent authority",
      llm_reasoning: "CRITICAL: This intent requests bulk deletion of production user data. Multiple red flags: (1) destructive operation, (2) production environment, (3) affects all users not just test data. The reasoning claims 'test data cleanup' but the action targets all records. This exceeds any safe agent authority scope. Rejecting.",
      resultStatus: "failed",
    });

    // Then the rejection reasoning is persisted
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toContain("CRITICAL");
    expect(record.llm_reasoning).toContain("bulk deletion");
    expect(record.evaluation?.decision).toBe("REJECT");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-3: Veto-window intent with LLM reasoning
  // ---------------------------------------------------------------------------
  it("intent sent to veto window stores the evaluator's reasoning about elevated risk", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent declares a medium-risk intent
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-veto");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Deploy feature toggle for new billing flow",
      reasoning: "Feature is ready for staged rollout behind toggle",
      action_spec: { provider: "deploy", action: "feature_toggle", params: { feature: "billing_v2", rollout: 10 } },
    });

    // When the evaluator routes to veto window with its reasoning
    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 65,
      reason: "Approved but requires human review due to billing system impact",
      llm_reasoning: "The intent deploys a billing feature toggle at 10% rollout. While the scope is limited, billing changes carry inherent financial risk. The reasoning is sound and the 10% rollout is cautious. Approving but routing to veto window for human oversight.",
      resultStatus: "pending_veto",
    });

    // Then the reasoning is available during the veto window
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toContain("billing changes carry inherent financial risk");
    expect(record.status).toBe("pending_veto");
    expect(record.veto_expires_at).toBeDefined();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-4: Human reasoning and LLM reasoning are distinct fields
  // ---------------------------------------------------------------------------
  it("human-authored reasoning and evaluator reasoning coexist as separate fields", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent provides its reasoning when declaring an intent
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-distinct");
    const humanReasoning = "I need to update the CI pipeline to fix the failing nightly builds";
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Update CI configuration",
      reasoning: humanReasoning,
      action_spec: { provider: "ci", action: "update_config" },
    });

    // When the evaluator provides its own reasoning
    const evaluatorReasoning = "CI configuration changes are medium risk. The reasoning is valid - nightly builds are failing. Scope is limited to CI config, no production code changes.";
    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 35,
      reason: "CI config change approved",
      llm_reasoning: evaluatorReasoning,
      resultStatus: "authorized",
    });

    // Then both reasoning fields are present and independent
    const record = await getIntentRecord(surreal, intentId);
    expect(record.reasoning).toBe(humanReasoning);
    expect(record.llm_reasoning).toBe(evaluatorReasoning);
    expect(record.reasoning).not.toBe(record.llm_reasoning);
  }, 30_000);
});

// =============================================================================
// Policy-Only Path: No LLM reasoning when evaluation is deterministic
// =============================================================================

describe("Step 02: Policy-only evaluations have no LLM reasoning", () => {
  // ---------------------------------------------------------------------------
  // S02-5: Policy-only approval has no llm_reasoning
  // ---------------------------------------------------------------------------
  it("policy-only approval does not have evaluator reasoning", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent that matches a deterministic policy rule
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-policy-approve");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Read workspace settings",
      reasoning: "Need workspace context for next task",
      action_spec: { provider: "workspace", action: "read_settings" },
    });

    // When the policy gate approves without LLM evaluation
    await simulatePolicyOnlyEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 0,
      reason: "Auto-approved by workspace read policy",
      resultStatus: "authorized",
    });

    // Then the intent has no LLM reasoning (field absent)
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toBeUndefined();
    expect(record.evaluation?.policy_only).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-6: Policy-only rejection has no llm_reasoning
  // ---------------------------------------------------------------------------
  it("policy-only rejection does not have evaluator reasoning", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent that a deterministic policy blocks
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-policy-reject");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Delete workspace",
      reasoning: "Workspace is no longer needed",
      action_spec: { provider: "workspace", action: "delete" },
    });

    // When the policy gate rejects without LLM evaluation
    await simulatePolicyOnlyEvaluation(surreal, intentId, {
      decision: "REJECT",
      risk_score: 0,
      reason: "Workspace deletion blocked by admin policy",
      resultStatus: "failed",
    });

    // Then the intent has no LLM reasoning
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toBeUndefined();
    expect(record.evaluation?.policy_only).toBe(true);
    expect(record.evaluation?.decision).toBe("REJECT");
  }, 30_000);
});

// =============================================================================
// Error / Edge Cases
// =============================================================================

describe("Step 02: Error and edge cases for intent reasoning", () => {
  // ---------------------------------------------------------------------------
  // S02-7: LLM reasoning persists through status transitions
  // ---------------------------------------------------------------------------
  it("LLM reasoning survives subsequent status transitions after evaluation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent that was evaluated with LLM reasoning and entered the veto window
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-transition");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Refactor authentication module",
      reasoning: "Simplify auth flow for better maintainability",
      action_spec: { provider: "file_editor", action: "refactor" },
    });

    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 55,
      reason: "Auth refactor approved with veto window",
      llm_reasoning: "Authentication refactoring is medium risk. The module is well-tested but central to security. Routing to veto window.",
      resultStatus: "pending_veto",
    });

    // When the intent transitions from pending_veto to authorized (veto window expires)
    const intentRecord = new RecordId("intent", intentId);
    await surreal.query(`UPDATE $intent SET status = "authorized", updated_at = time::now();`, {
      intent: intentRecord,
    });

    // Then the LLM reasoning is still present after the transition
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).toBe("authorized");
    expect(record.llm_reasoning).toContain("Authentication refactoring is medium risk");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-8: Very long LLM reasoning persists without truncation
  // ---------------------------------------------------------------------------
  it("extensive evaluator reasoning from complex analysis persists fully", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent requiring detailed analysis
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-long");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Migrate database schema",
      reasoning: "Moving to new schema for performance improvements",
      action_spec: { provider: "database", action: "migrate" },
    });

    // When the evaluator produces extensive reasoning
    const longReasoning = Array.from({ length: 40 }, (_, i) =>
      `Analysis step ${i + 1}: Evaluated migration impact on table set ${i + 1}.`,
    ).join(" ");

    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 70,
      reason: "Database migration approved with human oversight",
      llm_reasoning: longReasoning,
      resultStatus: "pending_veto",
    });

    // Then the full reasoning text is preserved
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toBe(longReasoning);
    expect(record.llm_reasoning!.length).toBeGreaterThan(2000);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-9: LLM reasoning with special characters persists correctly
  // ---------------------------------------------------------------------------
  it("evaluator reasoning containing quotes and technical notation persists correctly", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-special");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Update API rate limits",
      reasoning: "Current limits too restrictive for partner integrations",
      action_spec: { provider: "api", action: "update_rate_limits" },
    });

    // When reasoning contains special characters
    const reasoning = `Risk factors: (1) rate limit change from 100/min to 500/min = 5x increase. The agent's claim "partner needs higher limits" is plausible but unverified. Score: 45/100.`;

    await simulateEvaluationWithReasoning(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 45,
      reason: "Rate limit change approved",
      llm_reasoning: reasoning,
      resultStatus: "authorized",
    });

    // Then the special characters are preserved
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toBe(reasoning);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-10: Intent without evaluation has no llm_reasoning
  // ---------------------------------------------------------------------------
  it("draft intent that has not been evaluated has no evaluator reasoning", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent creates a draft intent but does not submit it
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-draft");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Pending task",
      reasoning: "Will submit when ready",
      action_spec: { provider: "test", action: "noop" },
    });

    // Then the intent has no LLM reasoning since it was never evaluated
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).toBe("draft");
    expect(record.llm_reasoning).toBeUndefined();
    expect(record.evaluation).toBeUndefined();
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-11: LLM timeout fallback has no llm_reasoning
  // ---------------------------------------------------------------------------
  it("when LLM evaluation times out, the fallback policy-only result has no reasoning", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent where LLM evaluation will time out
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-timeout");
    const { intentId } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Complex multi-service operation",
      reasoning: "Need to coordinate across multiple services",
      action_spec: { provider: "orchestrator", action: "multi_service" },
    });

    // When the LLM times out and falls back to policy-only
    await simulatePolicyOnlyEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 50,
      reason: "LLM evaluation timeout -- falling back to policy-only with veto window",
      resultStatus: "pending_veto",
    });

    // Then there is no LLM reasoning (the LLM never completed)
    const record = await getIntentRecord(surreal, intentId);
    expect(record.llm_reasoning).toBeUndefined();
    expect(record.evaluation?.policy_only).toBe(true);
    expect(record.evaluation?.reason).toContain("timeout");
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S02-12: Multiple intents in same workspace have independent reasoning
  // ---------------------------------------------------------------------------
  it("multiple intents maintain independent evaluator reasoning in the same workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with multiple intents
    const { workspaceId, identityId } = await setupReasoningWorkspace(baseUrl, surreal, "intent-multi");

    const { intentId: intent1 } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Read file",
      reasoning: "Need to read config",
      action_spec: { provider: "file_reader", action: "read" },
    });

    const { intentId: intent2 } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "Write file",
      reasoning: "Need to update config",
      action_spec: { provider: "file_editor", action: "write" },
    });

    const { intentId: intent3 } = await createDraftIntent(surreal, workspaceId, identityId, {
      goal: "List files",
      reasoning: "Need directory listing",
      action_spec: { provider: "file_reader", action: "list" },
    });

    // When each is evaluated differently
    await simulateEvaluationWithReasoning(surreal, intent1, {
      decision: "APPROVE",
      risk_score: 5,
      reason: "Safe read",
      llm_reasoning: "Read-only, minimal risk",
      resultStatus: "authorized",
    });

    await simulateEvaluationWithReasoning(surreal, intent2, {
      decision: "APPROVE",
      risk_score: 40,
      reason: "Write approved",
      llm_reasoning: "File write with moderate risk due to config changes",
      resultStatus: "pending_veto",
    });

    await simulatePolicyOnlyEvaluation(surreal, intent3, {
      decision: "APPROVE",
      risk_score: 0,
      reason: "Auto-approved by policy",
      resultStatus: "authorized",
    });

    // Then each has its own independent reasoning
    const r1 = await getIntentRecord(surreal, intent1);
    const r2 = await getIntentRecord(surreal, intent2);
    const r3 = await getIntentRecord(surreal, intent3);

    expect(r1.llm_reasoning).toBe("Read-only, minimal risk");
    expect(r2.llm_reasoning).toContain("moderate risk");
    expect(r3.llm_reasoning).toBeUndefined();
  }, 30_000);
});
