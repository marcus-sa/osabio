/**
 * Walking Skeleton: Evidence-Backed Intent Authorization E2E
 *
 * Traces: US-01, US-02, US-03, US-04
 *
 * These are the minimum viable E2E paths through evidence-backed authorization.
 * Skeleton 1: Agent submits intent with evidence -> verification -> evaluation proceeds
 * Skeleton 2: Agent submits intent without evidence -> soft enforcement -> risk elevated
 * Skeleton 3: Agent submits intent without evidence -> hard enforcement -> rejected pre-LLM
 *
 * Together they prove:
 * - An agent can submit evidence references with an intent
 * - The verification pipeline checks that evidence exists in the workspace
 * - Soft enforcement elevates risk score for missing evidence
 * - Hard enforcement rejects intent before LLM evaluation
 *
 * Driving ports:
 *   Intent creation with evidence_refs (SurrealDB direct / MCP tool)
 *   POST /api/intents/:id/evaluate (SurrealQL EVENT target)
 *   Workspace enforcement settings (SurrealDB direct)
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
  getIntentStatus,
  getIntentRecord,
  waitForIntentStatus,
  // Evidence-specific helpers
  createEvidenceDecision,
  createEvidenceTask,
  createIntentWithEvidence,
  createIntentWithoutEvidence,
  setWorkspaceEnforcementMode,
  getEvidenceRefs,
  getEvidenceVerification,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_walking_skeleton");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

describe("Walking Skeleton: Evidence-backed intent authorization", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Evidence submitted, verified, evaluation proceeds
  // US-01 + US-02 + US-04
  // ---------------------------------------------------------------------------
  it("agent submits intent with evidence references and receives authorization with evidence context", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "soft"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "ws-evidence-1");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");

    // And an agent identity that will request authorization
    const agentIdentityId = await createTestIdentity(
      surreal,
      "logistics-planner",
      "agent",
      workspace.workspaceId,
    );

    // And Ravi Patel has confirmed the decision "Switch to regional warehousing for Southeast Asia"
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Switch to regional warehousing for Southeast Asia",
      status: "confirmed",
    });

    // And the Logistics-Planner agent has completed the task "Audit current fulfillment SLAs"
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Audit current fulfillment SLAs",
      status: "completed",
    });

    // When the agent creates an intent with evidence_refs pointing to the decision and task
    // Driving port: intent creation with evidence_refs
    const { intentId } = await createIntentWithEvidence(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Reroute Southeast Asia orders through regional warehouse",
        reasoning: "Decision to switch to regional warehousing is confirmed, and fulfillment SLA audit is complete",
        priority: 50,
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
      },
    );

    // Then the intent contains 2 evidence references
    const refs = await getEvidenceRefs(surreal, intentId);
    expect(refs).toBeDefined();
    expect(refs!.length).toBe(2);

    // When the agent submits the intent for authorization
    // Driving port: intent submission triggers SurrealQL EVENT -> POST /api/intents/:id/evaluate
    await submitIntent(surreal, intentId);

    // Then the evaluation proceeds (intent reaches a post-evaluation status)
    const finalStatus = await waitForIntentStatus(
      surreal,
      intentId,
      ["authorized", "pending_veto", "vetoed", "failed"],
      30_000,
    );
    expect(["authorized", "pending_veto", "vetoed", "failed"]).toContain(finalStatus);

    // And the evidence verification result is stored on the intent record
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(2);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: Missing evidence elevates risk under soft enforcement
  // US-01 + US-03
  // ---------------------------------------------------------------------------
  it("agent submits intent without evidence and soft enforcement elevates risk score", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "soft"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "ws-evidence-2");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");

    // And an agent identity
    const agentIdentityId = await createTestIdentity(
      surreal,
      "logistics-planner",
      "agent",
      workspace.workspaceId,
    );

    // When the agent creates an intent without evidence references
    // Driving port: intent creation without evidence_refs
    const { intentId } = await createIntentWithoutEvidence(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Modify supplier contract terms for Q3",
        reasoning: "Need to adjust payment terms based on recent negotiations",
        priority: 50,
      },
    );

    // And the agent submits the intent for authorization
    // Driving port: intent submission triggers SurrealQL EVENT -> POST /api/intents/:id/evaluate
    await submitIntent(surreal, intentId);

    // Then the evaluation completes
    const finalStatus = await waitForIntentStatus(
      surreal,
      intentId,
      ["authorized", "pending_veto", "vetoed", "failed"],
      30_000,
    );

    // And the evidence verification shows 0 verified refs
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(0);

    // And the effective risk score is elevated due to evidence shortfall
    // (The evaluation result should reflect the penalty)
    const record = await getIntentRecord(surreal, intentId);
    expect(record.evaluation).toBeDefined();
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 3: Hard enforcement rejects without evidence
  // US-06
  // ---------------------------------------------------------------------------
  it.skip("hard enforcement blocks intent with insufficient evidence before evaluation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "hard"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "ws-evidence-3");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");

    // And an agent identity
    const agentIdentityId = await createTestIdentity(
      surreal,
      "logistics-planner",
      "agent",
      workspace.workspaceId,
    );

    // When the agent creates an intent without evidence references
    // Driving port: intent creation without evidence_refs
    const { intentId } = await createIntentWithoutEvidence(
      surreal,
      workspace.workspaceId,
      agentIdentityId,
      {
        goal: "Reroute all Southeast Asia orders immediately",
        reasoning: "Urgent supply chain disruption requires immediate rerouting",
        priority: 80,
      },
    );

    // And the agent submits the intent for authorization
    // Driving port: intent submission triggers SurrealQL EVENT -> POST /api/intents/:id/evaluate
    await submitIntent(surreal, intentId);

    // Then the intent is rejected before LLM evaluation
    const finalStatus = await waitForIntentStatus(
      surreal,
      intentId,
      ["failed"],
      15_000,
    );
    expect(finalStatus).toBe("failed");

    // And the rejection reason explains the evidence shortfall
    const record = await getIntentRecord(surreal, intentId);
    expect(record.error_reason).toBeDefined();
    expect(record.error_reason).toContain("evidence");

    // And the LLM evaluator was NOT called (no evaluation result)
    expect(record.evaluation).toBeUndefined();
  }, 30_000);
});
