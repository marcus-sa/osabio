/**
 * Milestone 2: Fabrication Resistance
 *
 * Traces: US-05, US-06, US-07
 *
 * Validates:
 * - Authorship independence check prevents self-referencing evidence
 * - Minimum evidence age blocks timing exploits
 * - Hard enforcement rejects insufficient evidence before LLM evaluation
 * - Risk-tiered evidence requirements scale with intent risk level
 * - Workspace auto-transitions from soft to hard enforcement at maturity threshold
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
  // Evidence-specific helpers
  createEvidenceDecision,
  createEvidenceTask,
  createEvidenceObservation,
  createIntentWithEvidence,
  createIntentWithoutEvidence,
  setWorkspaceEnforcementMode,
  setEnforcementThreshold,
  setMinimumEvidenceAge,
  getEvidenceVerification,
  getWorkspaceEnforcementMode,
  createMultipleAgentIdentities,
  createDecisionInOtherWorkspace,
  countConfirmedDecisions,
  countCompletedTasks,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m2");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

// =============================================================================
// US-05: Authorship Independence
// =============================================================================
describe("US-05: Authorship independence check", () => {
  it("high-risk intent passes with 2 independently authored evidence references", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with multiple identities
    // Driving port: workspace settings + identity creation (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us05-pass");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");

    const agents = await createMultipleAgentIdentities(surreal, workspace.workspaceId, [
      { name: "logistics-planner", type: "agent" },
      { name: "observer-agent", type: "agent" },
    ]);
    const raviId = await createTestIdentity(surreal, "ravi-patel", "human", workspace.workspaceId);
    const logisticsAgent = agents.find(a => a.name === "logistics-planner")!;

    // And evidence authored by different identities
    // Decision confirmed by Ravi (human), task by logistics-planner (self), observation by observer
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

    // When the agent creates a high-risk intent referencing all three
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, logisticsAgent.identityId,
      {
        goal: "Reroute all Southeast Asia orders through regional hub",
        reasoning: "Decision confirmed by admin, audit complete, lead time data supports",
        priority: 85,
        evidenceRefs: [decision.decisionRecord, task.taskRecord, observation.observationRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the authorship independence requirement is satisfied
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(3);
    // No authorship warnings means independence requirement was met
    const authorshipWarnings = (verification!.warnings ?? []).filter(
      w => w.toLowerCase().includes("independent"),
    );
    expect(authorshipWarnings).toHaveLength(0);
  }, 60_000);

  it.skip("self-referencing evidence fails authorship check for high-risk intent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us05-selfref");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");

    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And all 3 evidence references are observations created by the same agent
    const obs1 = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Self-authored observation 1",
      sourceAgent: "logistics-planner",
    });
    const obs2 = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Self-authored observation 2",
      sourceAgent: "logistics-planner",
    });
    const obs3 = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Self-authored observation 3",
      sourceAgent: "logistics-planner",
    });

    // When the agent creates a high-risk intent citing only its own observations
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Reroute all orders based on my own observations",
        reasoning: "All evidence is self-authored",
        priority: 85,
        evidenceRefs: [obs1.observationRecord, obs2.observationRecord, obs3.observationRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the authorship independence requirement fails
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.warnings).toBeDefined();
    expect(
      verification!.warnings!.some(w => w.toLowerCase().includes("independent")),
    ).toBe(true);
  }, 60_000);

  it.skip("agent-confirmed evidence counts as independent from another agent", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with two different agent identities
    // Driving port: workspace settings + identity creation (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us05-agentindep");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");

    const agents = await createMultipleAgentIdentities(surreal, workspace.workspaceId, [
      { name: "logistics-planner", type: "agent" },
      { name: "architect-agent", type: "agent" },
    ]);
    const logisticsAgent = agents.find(a => a.name === "logistics-planner")!;

    // And a decision confirmed by the architect-agent (different agent)
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Migrate to microservices architecture",
    });

    // When the logistics-planner references the architect's decision
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, logisticsAgent.identityId,
      {
        goal: "Implement microservices migration for logistics module",
        reasoning: "Architecture decision confirmed by architect agent",
        evidenceRefs: [decision.decisionRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the decision counts as independently authored evidence
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(1);
  }, 60_000);

  it.skip("low-risk intent has no authorship requirement even when self-authored", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us05-lowrisk");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the agent authored the evidence itself
    const obs = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Self-authored observation for low-risk action",
      sourceAgent: "logistics-planner",
    });

    // When the agent creates a low-risk intent citing its own observation
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Read current fulfillment metrics",
        reasoning: "Low-risk data read operation",
        priority: 15,
        evidenceRefs: [obs.observationRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then no authorship warning is generated for low-risk
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    const authorshipWarnings = (verification!.warnings ?? []).filter(
      w => w.toLowerCase().includes("independent"),
    );
    expect(authorshipWarnings).toHaveLength(0);
  }, 60_000);
});

// =============================================================================
// US-06: Minimum Evidence Age and Hard Enforcement
// =============================================================================
describe("US-06: Minimum evidence age and hard enforcement", () => {
  it.skip("recently created evidence fails minimum age check", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with minimum evidence age of 5 minutes
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us06-minage");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    await setMinimumEvidenceAge(surreal, workspace.workspaceId, 5);
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And an observation created just now (well under 5-minute minimum)
    const recentObs = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Just-created observation for timing exploit test",
      sourceAgent: "observer-agent",
    });

    // When the agent references the recent observation
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Act on very recent observation",
        reasoning: "Citing observation created moments ago",
        evidenceRefs: [recentObs.observationRecord],
      },
    );

    // And the verification pipeline runs
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the reference fails the minimum age check
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.warnings).toBeDefined();
    expect(
      verification!.warnings!.some(w => w.toLowerCase().includes("minimum age")),
    ).toBe(true);
  }, 60_000);

  it.skip("hard enforcement rejects intent with zero evidence references before evaluation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "hard"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us06-hardreject");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // When the agent creates an intent with no evidence
    // Driving port: intent creation (SurrealDB)
    const { intentId } = await createIntentWithoutEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Modify supplier contracts without any evidence",
        reasoning: "No evidence provided",
        priority: 50,
      },
    );

    // And the agent submits for authorization
    // Driving port: intent submission (SurrealQL EVENT -> POST /api/intents/:id/evaluate)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["failed"], 15_000);

    // Then the intent is rejected before LLM evaluation
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).toBe("failed");
    expect(record.error_reason).toBeDefined();
    expect(record.error_reason!.toLowerCase()).toContain("evidence");

    // And the LLM evaluator was NOT called
    expect(record.evaluation).toBeUndefined();
  }, 30_000);

  it.skip("hard enforcement passes intent with sufficient evidence to evaluation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence enforcement set to "hard"
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us06-hardpass");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And sufficient evidence exists
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Approve supplier contract renewal",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Complete contract review",
    });

    // When the agent creates an intent with required evidence
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Renew supplier contracts for Q3",
        reasoning: "Decision approved and contract review complete",
        priority: 50,
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
      },
    );

    // And the agent submits for authorization
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the intent proceeds to evaluation (not rejected)
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).not.toBe("failed");
    expect(record.evaluation).toBeDefined();
  }, 60_000);
});

// =============================================================================
// US-07: Risk-Tiered Evidence Requirements
// =============================================================================
describe("US-07: Risk-tiered evidence requirements", () => {
  it.skip("low-risk intent meets tier requirement with 1 reference of any type", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us07-lowrisk");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Read fulfillment metrics",
    });

    // When the agent creates a low-risk intent with 1 reference
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Read current fulfillment metrics for reporting",
        reasoning: "Low-risk data read operation",
        priority: 15,
        evidenceRefs: [task.taskRecord],
      },
    );

    // And the evaluation pipeline processes the intent
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the low-risk tier requirement is met
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBeGreaterThanOrEqual(1);
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).not.toBe("failed");
  }, 60_000);

  it.skip("high-risk intent fails when all references are observations and no decision or task", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us07-highmisstype");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");

    const agents = await createMultipleAgentIdentities(surreal, workspace.workspaceId, [
      { name: "logistics-planner", type: "agent" },
      { name: "observer-agent-1", type: "agent" },
      { name: "observer-agent-2", type: "agent" },
    ]);
    const logisticsAgent = agents.find(a => a.name === "logistics-planner")!;

    // And 3 observations (no decision, no task) -- fails high-risk type requirement
    const obs1 = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Supply chain disruption observed",
      sourceAgent: "observer-agent-1",
    });
    const obs2 = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Logistics bottleneck at port",
      sourceAgent: "observer-agent-2",
    });
    const obs3 = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Inventory levels critical",
      sourceAgent: "observer-agent-1",
    });

    // When the agent creates a high-risk intent with only observations
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, logisticsAgent.identityId,
      {
        goal: "Emergency reroute all orders based on observations only",
        reasoning: "Three observations but no decision or task to back the action",
        priority: 85,
        evidenceRefs: [obs1.observationRecord, obs2.observationRecord, obs3.observationRecord],
      },
    );

    // And the evaluation pipeline processes the intent
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the high-risk tier type requirement fails
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.warnings).toBeDefined();
    expect(
      verification!.warnings!.some(w => w.toLowerCase().includes("decision")),
    ).toBe(true);
  }, 60_000);

  it.skip("medium-risk intent meets requirement with decision and 1 independent author", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us07-medrisk");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "hard");
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Optimize regional allocation percentages",
    });
    const observation = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Current allocation is inefficient for Southeast Asia",
      sourceAgent: "observer-agent",
    });

    // When the agent creates a medium-risk intent with decision + observation
    // Driving port: intent creation with evidence_refs (SurrealDB)
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Adjust warehouse allocation percentages for Southeast Asia",
        reasoning: "Decision to optimize and observation of inefficiency",
        priority: 50,
        evidenceRefs: [decision.decisionRecord, observation.observationRecord],
      },
    );

    // And the evaluation pipeline processes the intent
    // Driving port: POST /api/intents/:id/evaluate (via SurrealQL EVENT)
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the medium-risk tier requirement is met
    const verification = await getEvidenceVerification(surreal, intentId);
    expect(verification).toBeDefined();
    expect(verification!.verified_count).toBe(2);
    const record = await getIntentRecord(surreal, intentId);
    expect(record.status).not.toBe("failed");
  }, 60_000);
});

// =============================================================================
// US-06: Auto-Transition from Soft to Hard
// =============================================================================
describe("US-06: Workspace enforcement auto-transition", () => {
  it.skip("workspace transitions from soft to hard when maturity threshold is reached", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace in "soft" enforcement mode
    // Driving port: workspace settings (SurrealDB)
    const user = await createTestUser(baseUrl, "m2-us06-transition");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    await setEnforcementThreshold(surreal, workspace.workspaceId, {
      min_decisions: 3,
      min_tasks: 2,
    });
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    // And the workspace accumulates enough decisions and tasks
    for (let i = 0; i < 3; i++) {
      await createEvidenceDecision(surreal, workspace.workspaceId, {
        summary: `Confirmed decision ${i + 1}`,
      });
    }
    for (let i = 0; i < 2; i++) {
      await createEvidenceTask(surreal, workspace.workspaceId, {
        title: `Completed task ${i + 1}`,
      });
    }

    // Verify preconditions
    const decisionCount = await countConfirmedDecisions(surreal, workspace.workspaceId);
    expect(decisionCount).toBeGreaterThanOrEqual(3);
    const taskCount = await countCompletedTasks(surreal, workspace.workspaceId);
    expect(taskCount).toBeGreaterThanOrEqual(2);

    // When an intent is evaluated (maturity check runs lazily at evaluation time)
    // Driving port: intent creation + submission (SurrealDB + SurrealQL EVENT)
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Evidence for transition trigger intent",
    });
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Trigger maturity check via evaluation",
        reasoning: "This intent triggers the lazy maturity threshold check",
        evidenceRefs: [decision.decisionRecord],
      },
    );
    await submitIntent(surreal, intentId);
    await waitForIntentStatus(surreal, intentId, ["authorized", "pending_veto", "vetoed", "failed"], 30_000);

    // Then the workspace enforcement transitions to "hard"
    const mode = await getWorkspaceEnforcementMode(surreal, workspace.workspaceId);
    expect(mode).toBe("hard");
  }, 60_000);
});
