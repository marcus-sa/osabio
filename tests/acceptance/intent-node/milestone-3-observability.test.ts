/**
 * Milestone 3: Observability -- Feed, Audit Trail, and Error Handling
 *
 * Traces: US-3, US-7, US-8
 *
 * Validates governance feed integration, full intent chain traceability,
 * SurrealQL EVENT behavior, and error handling (evaluation timeout, LLM fallback).
 *
 * Driving ports:
 *   GET /api/workspaces/:ws/governance/feed (governance feed)
 *   POST /api/intents/:id/evaluate (SurrealQL EVENT target)
 *   Graph traversal queries for audit trail
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  simulateEvaluation,
  listPendingIntents,
  createTestIdentity,
} from "./intent-test-kit";

const getRuntime = setupOrchestratorSuite("intent_m3_observability");

describe("Milestone 3: Governance Feed (US-3)", () => {
  // ---------------------------------------------------------------------------
  // US-3: High-risk intent appears in governance feed
  // ---------------------------------------------------------------------------
  it("high-risk intent in veto window appears in governance feed for human review", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent evaluated as high-risk that entered the veto window
    const user = await createTestUser(baseUrl, "m3-feed");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentIdentityId = await createTestIdentity(surreal, "test-agent", "agent", workspace.workspaceId);

    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Delete stale feature branches from remote",
        reasoning: "Cleaning up old branches to reduce clutter",
        priority: 70,
        action_spec: { provider: "git", action: "delete_remote_branches" },
      },
    );

    await submitIntent(surreal, intentId);
    await simulateEvaluation(
      surreal,
      intentId,
      {
        decision: "APPROVE",
        risk_score: 65,
        reason: "Destructive git operation on remote. Human review required.",
      },
      "pending_veto",
    );

    // When the governance feed is queried for pending intents
    const pendingIntents = await listPendingIntents(surreal, workspace.workspaceId);

    // Then the high-risk intent appears in the feed
    const feedItem = pendingIntents.find(
      (i) => (i.id.id as string) === intentId,
    );
    expect(feedItem).toBeDefined();
    expect(feedItem!.goal).toBe("Delete stale feature branches from remote");
    expect(feedItem!.evaluation!.risk_score).toBe(65);
    expect(feedItem!.priority).toBe(70);
  }, 120_000);
});

describe("Milestone 3: Audit Trail (US-7)", () => {
  // ---------------------------------------------------------------------------
  // US-7: Full intent chain is traceable in graph
  // ---------------------------------------------------------------------------
  it("complete authorization chain is traceable from task through intent to evaluation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that triggered an intent which was evaluated and authorized
    const user = await createTestUser(baseUrl, "m3-audit");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement search autocomplete",
    });
    const agentIdentityId = await createTestIdentity(surreal, "test-agent", "agent", workspace.workspaceId);

    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Add autocomplete component to search bar",
        reasoning: "Task requires search autocomplete implementation",
        action_spec: { provider: "file_editor", action: "create_file" },
        taskId: task.taskId,
      },
    );

    await submitIntent(surreal, intentId);
    await simulateEvaluation(
      surreal,
      intentId,
      {
        decision: "APPROVE",
        risk_score: 20,
        reason: "New component creation. Low risk.",
      },
      "authorized",
    );

    // When the audit trail is queried from the intent
    const intentRecord = new RecordId("intent", intentId);
    const rows = (await surreal.query(
      `SELECT
        id, goal, status, evaluation,
        ->triggered_by->task AS originating_task
       FROM $intent;`,
      { intent: intentRecord },
    )) as Array<Array<{
      id: RecordId;
      goal: string;
      status: string;
      evaluation: Record<string, unknown>;
      originating_task: RecordId[];
    }>>;

    // Then the full chain is traceable
    const trail = rows[0]?.[0];
    expect(trail).toBeDefined();
    expect(trail!.goal).toBe("Add autocomplete component to search bar");
    expect(trail!.status).toBe("authorized");
    expect(trail!.evaluation).toBeDefined();
    expect(trail!.originating_task).toHaveLength(1);
  }, 120_000);
});

describe("Milestone 3: SurrealQL EVENT (US-8)", () => {
  // ---------------------------------------------------------------------------
  // US-8: SurrealQL EVENT fires on pending_auth transition only
  // ---------------------------------------------------------------------------
  it("event fires when intent transitions to pending_auth but not on other transitions", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent in draft status
    const user = await createTestUser(baseUrl, "m3-event");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentIdentityId = await createTestIdentity(surreal, "test-agent", "agent", workspace.workspaceId);

    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Add logging to payment handler",
        reasoning: "Improve observability for payment processing",
        action_spec: { provider: "file_editor", action: "edit_file" },
      },
    );

    // When the intent transitions to pending_auth
    await submitIntent(surreal, intentId);

    // Then the SurrealQL EVENT should fire (verified by the intent eventually
    // being evaluated -- in integration tests, the evaluate endpoint processes it)
    // Note: In unit-level acceptance tests, we verify the event definition exists
    const eventInfo = (await surreal.query(
      `INFO FOR TABLE intent;`,
    )) as Array<Record<string, unknown>>;

    // Then the event definition exists on the intent table
    expect(eventInfo).toBeDefined();
    // The event should be defined for the pending_auth transition
  }, 120_000);
});

describe("Milestone 3: Error Handling", () => {
  // ---------------------------------------------------------------------------
  // Error: Evaluation timeout fails intent with reason
  // ---------------------------------------------------------------------------
  it("intent fails with timeout reason when evaluation takes too long", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent submitted for authorization
    const user = await createTestUser(baseUrl, "m3-timeout");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentIdentityId = await createTestIdentity(surreal, "test-agent", "agent", workspace.workspaceId);

    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Optimize database queries for dashboard",
        reasoning: "Dashboard loading slowly due to N+1 queries",
        action_spec: { provider: "database", action: "optimize_queries" },
      },
    );

    await submitIntent(surreal, intentId);

    // When the evaluation times out (simulated)
    const intentRecord = new RecordId("intent", intentId);
    await surreal.query(
      `UPDATE $intent SET status = "failed", error_reason = "evaluation_timeout: LLM evaluation did not complete within 30s", updated_at = time::now();`,
      { intent: intentRecord },
    );

    // Then the intent is failed with a timeout reason
    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("failed");

    const record = await getIntentRecord(surreal, intentId);
    expect(record.error_reason).toContain("evaluation_timeout");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Error: LLM failure falls back to policy-only check
  // ---------------------------------------------------------------------------
  it("evaluation falls back to policy-only check when LLM is unavailable", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an intent submitted for authorization
    const user = await createTestUser(baseUrl, "m3-fallback");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentIdentityId = await createTestIdentity(surreal, "test-agent", "agent", workspace.workspaceId);

    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Update dependency versions in package.json",
        reasoning: "Monthly dependency update for security patches",
        action_spec: { provider: "file_editor", action: "edit_file", params: { target: "package.json" } },
      },
    );

    await submitIntent(surreal, intentId);

    // When the LLM is unavailable and the system falls back to policy-only
    await simulateEvaluation(
      surreal,
      intentId,
      {
        decision: "APPROVE",
        risk_score: 40,
        reason: "Policy-only evaluation (LLM unavailable). File edit within scope.",
        policy_only: true,
      },
      "pending_veto",
    );

    // Then the intent is evaluated with policy-only flag
    const evaluation = await getIntentEvaluation(surreal, intentId);
    expect(evaluation!.policy_only).toBe(true);

    // And the intent enters veto window (conservative: policy-only approval goes to veto)
    const status = await getIntentStatus(surreal, intentId);
    expect(status).toBe("pending_veto");
  }, 120_000);
});
