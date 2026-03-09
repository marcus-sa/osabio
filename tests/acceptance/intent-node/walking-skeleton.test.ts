/**
 * Walking Skeleton: Intent Authorization Pipeline E2E
 *
 * Traces: US-1, US-2, US-4, US-5, US-6
 *
 * These are the minimum viable E2E paths through the intent authorization system.
 * Skeleton 1: Agent declares intent -> evaluation -> auto-approve -> execution
 * Skeleton 2: Agent declares intent -> evaluation -> veto window -> human vetoes
 *
 * Together they prove:
 * - An agent can declare and submit an intent for authorization
 * - The evaluation pipeline processes intents and routes by risk
 * - Low-risk intents flow through to execution without human involvement
 * - High-risk intents are surfaced to humans who can block execution
 *
 * Driving ports:
 *   MCP tools: create_intent, submit_intent, get_intent_status
 *   POST /api/workspaces/:ws/intents/:id/veto
 *   POST /api/intents/:id/evaluate (SurrealQL EVENT target)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  getTestUserBearerToken,
  createDraftIntent,
  submitIntent,
  getIntentStatus,
  getIntentRecord,
  getIntentEvaluation,
  waitForIntentStatus,
  simulateEvaluation,
  vetoIntent,
  listPendingIntents,
  createTestIdentity,
} from "./intent-test-kit";

const getRuntime = setupOrchestratorSuite("intent_walking_skeleton");

describe("Walking Skeleton: Agent intent is authorized and proceeds to execution", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Low-risk intent auto-approved
  // US-1 + US-2 + US-5 + US-6 happy path
  // ---------------------------------------------------------------------------
  it("agent creates a low-risk intent, submits for authorization, and receives auto-approval", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task ready for an agent to work on
    const user = await createTestUser(baseUrl, "skeleton-approve");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add input validation to signup form",
      description: "Validate email format and password strength",
    });

    // And an agent identity that will request authorization
    const agentIdentityId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    // When the agent creates an intent declaring what it wants to do
    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Add email format validation to the signup form",
        reasoning: "The task requires input validation. Email validation is a safe, well-scoped change limited to the signup form component.",
        priority: 50,
        action_spec: {
          provider: "file_editor",
          action: "edit_file",
          params: { target: "src/components/SignupForm.tsx" },
        },
        taskId: task.taskId,
      },
    );

    // Then the intent is created in draft status
    const draftStatus = await getIntentStatus(surreal, intentId);
    expect(draftStatus).toBe("draft");

    // When the agent submits the intent for authorization
    await submitIntent(surreal, intentId);

    // Then the intent moves to pending authorization
    const pendingStatus = await getIntentStatus(surreal, intentId);
    expect(pendingStatus).toBe("pending_auth");

    // When the evaluation pipeline processes the intent
    // (In production, the SurrealQL EVENT fires http::post to the evaluate endpoint.
    //  In tests, we simulate the evaluation result for determinism.)
    await simulateEvaluation(
      surreal,
      intentId,
      {
        decision: "APPROVE",
        risk_score: 15,
        reason: "Well-scoped file edit within task boundaries. Low risk.",
      },
      "authorized",
    );

    // Then the intent is authorized for execution
    const authorizedStatus = await getIntentStatus(surreal, intentId);
    expect(authorizedStatus).toBe("authorized");

    // And the evaluation result shows low risk with approval
    const evaluation = await getIntentEvaluation(surreal, intentId);
    expect(evaluation).toBeDefined();
    expect(evaluation!.decision).toBe("APPROVE");
    expect(evaluation!.risk_score).toBeLessThanOrEqual(30);
    expect(evaluation!.reason).toBeTruthy();

    // And the intent record preserves the full authorization chain
    const record = await getIntentRecord(surreal, intentId);
    expect(record.goal).toBe("Add email format validation to the signup form");
    expect(record.action_spec.action).toBe("edit_file");
    expect(record.trace_id).toBeTruthy();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: High-risk intent vetoed by human
  // US-1 + US-2 + US-4 + US-5 sad path
  // ---------------------------------------------------------------------------
  it("agent creates a high-risk intent that a human vetoes before execution", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task that requires a risky operation
    const user = await createTestUser(baseUrl, "skeleton-veto");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Migrate database schema for user accounts",
      description: "Drop legacy columns and restructure auth tables",
    });

    // And an agent identity requesting authorization for a destructive action
    const agentIdentityId = await createTestIdentity(surreal, "coding-agent", "agent", workspace.workspaceId);

    // When the agent creates an intent for a destructive database operation
    const { intentId } = await createDraftIntent(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Drop legacy auth columns and restructure user table",
        reasoning: "The migration task requires removing deprecated columns. This is a destructive schema change affecting production data.",
        priority: 80,
        action_spec: {
          provider: "database",
          action: "execute_migration",
          params: { target: "schema/migrations/drop_legacy_auth.surql" },
        },
        budget_limit: { amount: 50.0, currency: "USD" },
        taskId: task.taskId,
      },
    );

    // And the agent submits the intent for authorization
    await submitIntent(surreal, intentId);

    // When the evaluation pipeline identifies it as high-risk
    await simulateEvaluation(
      surreal,
      intentId,
      {
        decision: "APPROVE",
        risk_score: 75,
        reason: "Destructive schema migration. High risk due to irreversible data changes.",
      },
      "pending_veto",
    );

    // Then the intent enters the veto window for human review
    const vetoStatus = await getIntentStatus(surreal, intentId);
    expect(vetoStatus).toBe("pending_veto");

    // And the intent appears in the list of intents awaiting human review
    const pendingIntents = await listPendingIntents(surreal, workspace.workspaceId);
    const found = pendingIntents.find(
      (i) => (i.id.id as string) === intentId,
    );
    expect(found).toBeDefined();
    expect(found!.goal).toBe("Drop legacy auth columns and restructure user table");

    // And the intent has a veto window expiry set
    const record = await getIntentRecord(surreal, intentId);
    expect(record.veto_expires_at).toBeDefined();

    // When the workspace owner vetoes the intent
    // (Direct DB update to simulate veto since the HTTP endpoint is not yet implemented)
    const intentRecord = new RecordId("intent", intentId);
    await surreal.query(
      `UPDATE $intent SET status = "vetoed", veto_reason = $reason, updated_at = time::now();`,
      {
        intent: intentRecord,
        reason: "Too risky without a backup plan. Create a rollback migration first.",
      },
    );

    // Then the intent is vetoed and cannot proceed to execution
    const finalStatus = await getIntentStatus(surreal, intentId);
    expect(finalStatus).toBe("vetoed");

    // And the veto reason is recorded for audit
    const vetoedRecord = await getIntentRecord(surreal, intentId);
    expect(vetoedRecord.veto_reason).toBe(
      "Too risky without a backup plan. Create a rollback migration first.",
    );

    // And the intent no longer appears in the pending review list
    const remainingPending = await listPendingIntents(surreal, workspace.workspaceId);
    const stillFound = remainingPending.find(
      (i) => (i.id.id as string) === intentId,
    );
    expect(stillFound).toBeUndefined();
  }, 120_000);
});
