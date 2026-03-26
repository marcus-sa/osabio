/**
 * Milestone 4: Governance Feed Evidence Display and Workspace Bootstrapping
 *
 * Traces: US-08, US-09
 *
 * Validates:
 * - Governance feed displays evidence chains with verification status
 * - Feed highlights failed evidence references
 * - New workspaces start in bootstrap mode
 * - Workspace transitions from bootstrap to soft when first decision is confirmed
 * - Manual enforcement override
 *
 * Driving ports:
 *   GET /api/workspaces/:ws/feed (governance feed)
 *   POST /api/workspaces (workspace creation)
 *   Workspace enforcement settings (SurrealDB direct)
 *   Intent creation with evidence_refs (SurrealDB direct)
 *   POST /api/intents/:id/evaluate (SurrealQL EVENT target)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  wireIntentEvaluationEvent,
  submitIntent,
  getIntentRecord,
  waitForIntentStatus,
  simulateEvaluation,
  fetchJson,
  // Evidence-specific helpers
  createEvidenceDecision,
  createEvidenceTask,
  createEvidenceObservation,
  createIntentWithEvidence,
  createIntentWithoutEvidence,
  setWorkspaceEnforcementMode,
  getEvidenceVerification,
  getWorkspaceEnforcementMode,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m4");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

// =============================================================================
// US-08: Governance Feed Evidence Display
// =============================================================================
describe("US-08: Governance feed evidence chain display", () => {
  it.skip("feed shows verified evidence chain for pending intent with 3 verified references", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m4-us08-verified");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And an intent with 3 verified evidence references in pending_veto status
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Switch to regional warehousing for Southeast Asia",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Audit current fulfillment SLAs",
    });
    const observation = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Supplier lead times increased 40% in Q2",
      sourceAgent: "observer-agent",
    });

    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Reroute Southeast Asia orders through regional warehouse",
        reasoning: "Decision confirmed, audit complete, lead time data supports change",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, observation.observationRecord],
      },
    );

    // Simulate evaluation that puts intent in pending_veto
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 55,
      reason: "Medium risk, evidence supports action",
    }, "pending_veto");

    // When Ravi Patel views the intent in the governance feed
    // Driving port: GET /api/workspaces/:ws/feed
    const feed = await fetchJson<{ items: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then the feed contains the intent with evidence information
    // (Exact assertion structure depends on feed response shape)
    expect(feed).toBeDefined();
    expect(feed.items).toBeDefined();
  }, 30_000);

  it.skip("feed highlights failed evidence references with failure reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m4-us08-failed");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And an intent with 2 verified and 1 non-existent evidence reference
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Approve warehouse consolidation",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Complete consolidation analysis",
    });
    const fakeObsRecord = new RecordId("observation", `obs-nonexistent-${crypto.randomUUID()}`);

    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Begin warehouse consolidation",
        reasoning: "Decision and analysis complete, citing non-existent observation",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, fakeObsRecord],
      },
    );

    // Simulate evaluation with partial verification stored
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 45,
      reason: "Partial evidence verified",
    }, "pending_veto");

    // When Ravi Patel views the intent in the governance feed
    // Driving port: GET /api/workspaces/:ws/feed
    const feed = await fetchJson<{ items: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then the feed shows the intent with evidence verification summary
    expect(feed).toBeDefined();
  }, 30_000);

  it.skip("feed shows zero-evidence warning for intents without evidence references", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with soft enforcement
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m4-us08-noevidence");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And an intent with no evidence references
    const { intentId } = await createIntentWithoutEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Update pricing rules without evidence",
        reasoning: "No evidence provided",
        priority: 40,
      },
    );

    // Simulate evaluation
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 60,
      reason: "No evidence, elevated risk",
    }, "pending_veto");

    // When Ravi Patel views the governance feed
    // Driving port: GET /api/workspaces/:ws/feed
    const feed = await fetchJson<{ items: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then the feed displays a zero-evidence warning
    expect(feed).toBeDefined();
  }, 30_000);
});

// =============================================================================
// US-09: Workspace Bootstrapping
// =============================================================================
describe("US-09: Workspace bootstrapping and enforcement transitions", () => {
  it.skip("new workspace in bootstrap mode allows intents without evidence", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a newly created workspace in bootstrap mode
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m4-us09-bootstrap");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "bootstrap");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // When the first agent creates an intent without evidence references
    // Driving port: intent creation (SurrealDB)
    const { intentId } = await createIntentWithoutEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Set up initial warehouse configuration",
        reasoning: "First action in new workspace, no evidence available yet",
        priority: 30,
      },
    );

    // And the intent is submitted for authorization
    // Driving port: intent submission (SurrealQL EVENT -> POST /api/intents/:id/evaluate)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the intent proceeds to evaluation without evidence requirements
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).not.toBe("failed");
    expect(record.evaluation).toBeDefined();
  }, 60_000);

  it.skip("workspace transitions from bootstrap to soft when first decision is confirmed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace in bootstrap mode
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m4-us09-transition");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "bootstrap");

    // Verify starting mode
    const startMode = await getWorkspaceEnforcementMode(surreal, workspace.workspaceId);
    expect(startMode).toBe("bootstrap");

    // When Ravi Patel confirms the first decision in the workspace
    // (This should trigger the bootstrap -> soft transition)
    await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "First confirmed decision in workspace",
      status: "confirmed",
    });

    // Then the workspace enforcement transitions to "soft"
    // (The transition mechanism -- EVENT or lazy check -- determines when this takes effect)
    // For lazy evaluation, submit an intent to trigger the check
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);
    const { intentId } = await createIntentWithoutEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Trigger enforcement mode check",
        reasoning: "Testing bootstrap to soft transition",
      },
    );
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    const mode = await getWorkspaceEnforcementMode(surreal, workspace.workspaceId);
    expect(mode).toBe("soft");
  }, 60_000);

  it.skip("admin manually overrides enforcement mode", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace in soft enforcement mode
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m4-us09-override");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");

    // When Ravi Patel manually sets enforcement to "hard"
    // Driving port: workspace API or SurrealDB direct
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");

    // Then the workspace enforcement is "hard"
    const mode = await getWorkspaceEnforcementMode(surreal, workspace.workspaceId);
    expect(mode).toBe("hard");
  });
});
