/**
 * Milestone 1: Core Evidence Verification
 *
 * Traces: US-01, US-02, US-03, US-04
 *
 * Validates:
 * - Evidence references can be submitted with intents
 * - Verification pipeline checks existence, scope, temporal ordering, liveness
 * - Soft enforcement adjusts risk score for evidence shortfalls
 * - Verification results are stored on intent records
 *
 * Driving ports:
 *   Intent creation with evidence_refs (SurrealDB direct)
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
  getIntentRecord,
  waitForIntentStatus,
  simulateEvaluation,
  // Evidence-specific helpers
  createEvidenceDecision,
  createEvidenceTask,
  createEvidenceObservation,
  createIntentWithEvidence,
  createIntentWithoutEvidence,
  setWorkspaceEnforcementMode,
  getEvidenceRefs,
  getEvidenceVerification,
  createDecisionInOtherWorkspace,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m1");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

// =============================================================================
// US-01: Evidence Schema and Submission
// =============================================================================
describe("US-01: Evidence references on intent submission", () => {
  it("agent submits intent with valid evidence references to decision and task", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "soft"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us01-valid");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");

    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And Ravi Patel has confirmed the decision "Switch to regional warehousing for Southeast Asia"
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Switch to regional warehousing for Southeast Asia",
    });

    // And the Logistics-Planner has completed the task "Audit current fulfillment SLAs"
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Audit current fulfillment SLAs",
    });

    // When the agent creates an intent with evidence_refs pointing to both records
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Reroute Southeast Asia orders through regional warehouse",
        reasoning: "Regional warehousing decision confirmed and SLA audit complete",
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
      },
    );

    // Then the intent record contains 2 evidence references
    const refs = await getEvidenceRefs(surreal, intentId);
    expect(refs).toBeDefined();
    expect(refs!.length).toBe(2);
  });

  it("agent submits intent without evidence references and field is absent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us01-noevidence");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // When the agent creates an intent without evidence_refs
    // Driving port: intent creation (SurrealDB)
    const { intentId } = await createIntentWithoutEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Update pricing rules for Q3 catalog",
        reasoning: "Quarterly pricing refresh needed",
      },
    );

    // Then the evidence_refs field is absent from the record
    const refs = await getEvidenceRefs(surreal, intentId);
    expect(refs).toBeUndefined();
  });

  it.skip("agent cannot submit intent with references to unsupported entity types", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us01-invalid");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // When the agent tries to create an intent with a reference to an unsupported entity type
    // Driving port: intent creation (SurrealDB) -- schema should reject invalid record types
    // Then the creation fails with a validation error
    // (The exact assertion depends on how SurrealDB SCHEMAFULL rejects the invalid type)
    await expect(
      createIntentWithEvidence(
        surreal, workspace.workspaceId, agentId,
        {
          goal: "Test invalid ref type",
          reasoning: "Testing schema validation",
          evidenceRefs: [new RecordId("message", "invalid-ref")],
        },
      ),
    ).rejects.toThrow();
  });
});

// =============================================================================
// US-02: Deterministic Verification Pipeline
// =============================================================================
describe("US-02: Deterministic evidence verification", () => {
  it.skip("all evidence references pass verification when valid", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence entities
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us02-allpass");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the workspace contains a confirmed decision, completed task, and verified observation
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

    // When the agent creates an intent referencing all three records
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Reroute Southeast Asia orders through regional warehouse",
        reasoning: "Decision confirmed, audit complete, lead time data supports change",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, observation.observationRecord],
      },
    );

    // And the verification pipeline runs (triggered by intent submission)
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the verification result shows 3 verified references
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(3);
    expect(verification!.failed_refs ?? []).toHaveLength(0);
    expect(verification!.verification_time_ms).toBeLessThan(100);
  }, 60_000);

  it.skip("non-existent evidence reference fails verification", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us02-nonexist");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // When the agent references an observation that does not exist
    // Driving port: intent creation with non-existent evidence_ref (SurrealDB)
    const fakeObsRecord = new RecordId("observation", `obs-does-not-exist-${crypto.randomUUID()}`);
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Modify supplier terms based on market observation",
        reasoning: "Citing an observation that does not exist",
        evidenceRefs: [fakeObsRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the failed references list contains the non-existent observation
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(0);
    expect(verification!.failed_refs).toBeDefined();
    expect(verification!.failed_refs!.length).toBeGreaterThan(0);
  }, 60_000);

  it.skip("cross-workspace evidence reference fails scope check", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace "Acme Supply Chain"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us02-crossws");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And a decision exists in workspace "Other Organization"
    const otherDecision = await createDecisionInOtherWorkspace(surreal, {
      summary: "Adopt lean inventory strategy",
      otherWorkspaceName: "Other Organization",
    });

    // When the agent creates an intent in "Acme Supply Chain" referencing the other workspace's decision
    // Driving port: intent creation with cross-workspace evidence_ref (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Apply lean inventory practices from partner organization",
        reasoning: "Citing a decision from another workspace",
        evidenceRefs: [otherDecision.decisionRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the failed references list contains the cross-workspace decision
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.failed_refs).toBeDefined();
    expect(verification!.failed_refs!.length).toBeGreaterThan(0);
  }, 60_000);

  it.skip("superseded decision fails liveness check", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us02-superseded");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the decision "Original supplier routing policy" has been superseded
    const superseded = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Original supplier routing policy",
      status: "superseded",
    });

    // When the agent references this superseded decision as evidence
    // Driving port: intent creation with superseded evidence_ref (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Apply original routing policy to new region",
        reasoning: "Citing a decision that has been superseded",
        evidenceRefs: [superseded.decisionRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the verification warns about the superseded decision
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.failed_refs).toBeDefined();
    expect(verification!.failed_refs!.length).toBeGreaterThan(0);
    expect(verification!.warnings).toBeDefined();
    expect(verification!.warnings!.some(w => w.toLowerCase().includes("superseded"))).toBe(true);
  }, 60_000);

  it.skip("evidence created after intent fails temporal ordering check", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us02-temporal");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the agent creates an intent first
    // Driving port: intent creation (SurrealDB)
    const { intentId, intentRecord } = await createIntentWithoutEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Adjust warehouse allocation based on upcoming observation",
        reasoning: "Observation will be created after this intent",
      },
    );

    // And then an observation is created AFTER the intent (simulating a temporal violation)
    await Bun.sleep(100); // Ensure created_at is after intent
    const futureObs = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Observation created after the intent",
      sourceAgent: "observer-agent",
    });

    // And the evidence ref is added to the intent (pointing to future-dated evidence)
    await surreal.query(
      `UPDATE $intent SET evidence_refs = $refs;`,
      { intent: intentRecord, refs: [futureObs.observationRecord] },
    );

    // When the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the failed references list contains the future-dated reference
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.failed_refs).toBeDefined();
    expect(verification!.failed_refs!.length).toBeGreaterThan(0);
  }, 60_000);
});

// =============================================================================
// US-03: Soft Enforcement
// =============================================================================
describe("US-03: Soft enforcement adjusts risk score", () => {
  it.skip("evidence shortfall elevates effective risk score under soft enforcement", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "soft"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us03-shortfall");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And an intent with only 1 evidence ref (below medium-risk tier requirement of 2)
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Review supplier contracts",
    });
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Renegotiate supplier terms for Southeast Asia corridor",
        reasoning: "Contract review task is complete but no decision on record",
        priority: 50,
        evidenceRefs: [task.taskRecord],
      },
    );

    // When the evaluation pipeline processes the intent
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the evaluation result reflects the evidence penalty
    const record = await getIntentRecord(surreal, intentId);
    expect(record.evaluation).toBeDefined();
    // The effective risk score should be higher than the base LLM risk score
    // (Exact assertion depends on whether effective_risk_score is stored separately)
  }, 60_000);

  it.skip("full evidence keeps risk score unchanged under soft enforcement", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "soft"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us03-full");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And an intent with sufficient evidence for its risk tier
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Approve regional warehousing expansion",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Complete warehouse capacity analysis",
    });
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Begin regional warehousing expansion phase 1",
        reasoning: "Decision approved and capacity analysis complete",
        priority: 50,
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
      },
    );

    // When the evaluation pipeline processes the intent
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then no evidence penalty is applied
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(2);
    expect(verification!.failed_refs ?? []).toHaveLength(0);
  }, 60_000);
});

// =============================================================================
// US-04: Verification Result Storage
// =============================================================================
describe("US-04: Verification result storage and LLM context", () => {
  it.skip("verification result is persisted on intent record with verified count and timing", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence entities
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us04-persist");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Consolidate suppliers for Southeast Asia",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Map current supplier landscape",
    });
    const observation = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Three suppliers account for 80% of regional volume",
      sourceAgent: "observer-agent",
    });

    // When the agent submits an intent with 3 evidence refs and verification runs
    // Driving port: intent creation + submission (SurrealDB + SurrealQL EVENT)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Begin supplier consolidation for Southeast Asia",
        reasoning: "Decision confirmed, supplier landscape mapped, concentration observed",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, observation.observationRecord],
      },
    );
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the intent record stores the verification result
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(3);
    expect(verification!.verification_time_ms).toBeGreaterThan(0);
    expect(verification!.verification_time_ms).toBeLessThan(500);
  }, 60_000);

  it.skip("failed references are individually identified with failure reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m1-us04-failrefs");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And 1 valid task and 1 non-existent observation
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Complete regional analysis",
    });
    const fakeObsRecord = new RecordId("observation", `obs-nonexistent-${crypto.randomUUID()}`);

    // When the agent submits an intent with both refs
    // Driving port: intent creation + submission (SurrealDB + SurrealQL EVENT)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Execute regional optimization plan",
        reasoning: "Task complete but citing non-existent observation",
        evidenceRefs: [task.taskRecord, fakeObsRecord],
      },
    );
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the verification result shows 1 verified and 1 failed
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(1);
    expect(verification!.failed_refs).toBeDefined();
    expect(verification!.failed_refs!.length).toBe(1);
  }, 60_000);
});
