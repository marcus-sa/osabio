/**
 * Milestone 5: Feed Evidence Cards -- Per-Reference Evidence Detail
 *
 * Validates:
 * - Governance feed items include per-reference evidence detail (evidenceRefs)
 * - Each ref has entityId, entityKind, title, verified boolean, and optional failureReason
 * - Feed items include an evidenceSummary with verified/total counts
 *
 * Driving ports:
 *   GET /api/workspaces/:ws/feed (governance feed)
 *   Intent creation with evidence_refs (SurrealDB direct)
 *   POST /api/intents/:id/evaluate (SurrealQL EVENT target)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import type {
  GovernanceFeedItem,
  EvidenceRefDetail,
  EvidenceSummary,
} from "../../../app/src/shared/contracts";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  wireIntentEvaluationEvent,
  simulateEvaluation,
  fetchJson,
  // Evidence-specific helpers
  createEvidenceDecision,
  createEvidenceTask,
  createEvidenceObservation,
  createIntentWithEvidence,
  setWorkspaceEnforcementMode,
  createDecisionInOtherWorkspace,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m5");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

// =============================================================================
// M5-1: Per-reference evidence detail in feed items
// =============================================================================
describe("M5-1: Feed evidence cards with per-ref detail", () => {
  it("feed item includes evidenceRefs array with per-ref detail and evidenceSummary", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with soft enforcement
    const user = await createTestUser(baseUrl, "m5-evidence-cards");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "supply-chain-planner", "agent", workspace.workspaceId);

    // And an intent with 3 evidence references (decision, task, observation)
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Consolidate distribution centers in Nordic region",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Complete Nordic logistics cost analysis",
    });
    const observation = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Nordic shipping costs reduced 25% after carrier renegotiation",
      sourceAgent: "observer-agent",
    });

    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Merge Nordic distribution centers into single hub",
        reasoning: "Decision confirmed, cost analysis done, shipping savings observed",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, observation.observationRecord],
      },
    );

    // Simulate evaluation that puts intent in pending_veto
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 50,
      reason: "Evidence supports consolidation",
    }, "pending_veto");

    // When the governance feed is queried
    const feed = await fetchJson<{ items: Array<GovernanceFeedItem> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then find the intent feed item
    const intentItem = feed.items.find(
      (item) => item.entityKind === "intent" && item.entityId.includes(intentId),
    );
    expect(intentItem).toBeDefined();

    // Then the feed item has evidenceRefs with per-ref detail
    const refs = intentItem!.evidenceRefs;
    expect(refs).toBeDefined();
    expect(refs).toBeArrayOfSize(3);

    // Each ref has entityId, entityKind, title, verified boolean
    for (const ref of refs!) {
      expect(ref.entityId).toBeString();
      expect(ref.entityKind).toBeString();
      expect(ref.title).toBeString();
      expect(typeof ref.verified).toBe("boolean");
    }

    // Verify specific evidence references are present with correct kinds
    const decisionRef = refs!.find((r) => r.entityKind === "decision");
    expect(decisionRef).toBeDefined();
    expect(decisionRef!.title).toContain("Consolidate distribution centers");

    const taskRef = refs!.find((r) => r.entityKind === "task");
    expect(taskRef).toBeDefined();
    expect(taskRef!.title).toContain("Nordic logistics cost analysis");

    const obsRef = refs!.find((r) => r.entityKind === "observation");
    expect(obsRef).toBeDefined();
    expect(obsRef!.title).toContain("Nordic shipping costs");

    // Then the feed item has evidenceSummary with verified/total counts
    const summary = intentItem!.evidenceSummary;
    expect(summary).toBeDefined();
    expect(summary!.total).toBe(3);
    expect(typeof summary!.verified).toBe("number");
    expect(summary!.verified).toBeGreaterThanOrEqual(0);
    expect(summary!.verified).toBeLessThanOrEqual(3);
  }, 30_000);
});

// =============================================================================
// M5-2: Evidence refs join with entity titles and verification results
// =============================================================================
describe("M5-2: Feed query joins evidence_refs with entity titles and verification results", () => {
  it("feed item includes evidenceRefs with entityId entityKind title verified for each ref and evidenceSummary shows verified 2 total 2", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with soft enforcement
    const user = await createTestUser(baseUrl, "m5-evidence-join");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "logistics-optimizer", "agent", workspace.workspaceId);

    // And 2 evidence references: a confirmed decision and a completed task
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Adopt just-in-time inventory for European warehouses",
      status: "confirmed",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Audit current European warehouse stock levels",
      status: "completed",
    });

    // And an intent referencing both as evidence
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Transition European warehouses to JIT inventory model",
        reasoning: "Decision confirmed and audit completed",
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
      },
    );

    // And the intent has evidence_verification showing both refs verified
    await surreal.query(
      `UPDATE $intent SET evidence_verification = $ev;`,
      {
        intent: new RecordId("intent", intentId),
        ev: {
          verified_count: 2,
          total_count: 2,
          failed_refs: [],
          warnings: [],
          enforcement_mode: "soft",
          tier_met: true,
          verification_time_ms: 10,
        },
      },
    );

    // And the intent is in pending_veto status
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 40,
      reason: "All evidence verified",
    }, "pending_veto");

    // When the governance feed is queried
    const feed = await fetchJson<{ items: Array<GovernanceFeedItem> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then find the intent feed item
    const intentItem = feed.items.find(
      (item) => item.entityKind === "intent" && item.entityId.includes(intentId),
    );
    expect(intentItem).toBeDefined();

    // Then the feed item has evidenceRefs with 2 entries
    const refs = intentItem!.evidenceRefs;
    expect(refs).toBeDefined();
    expect(refs).toBeArrayOfSize(2);

    // Each ref has correct entityKind, title, and verified=true
    const decisionRef = refs!.find((r) => r.entityKind === "decision");
    expect(decisionRef).toBeDefined();
    expect(decisionRef!.entityId).toBe(decision.decisionId);
    expect(decisionRef!.title).toBe("Adopt just-in-time inventory for European warehouses");
    expect(decisionRef!.verified).toBe(true);

    const taskRef = refs!.find((r) => r.entityKind === "task");
    expect(taskRef).toBeDefined();
    expect(taskRef!.entityId).toBe(task.taskId);
    expect(taskRef!.title).toBe("Audit current European warehouse stock levels");
    expect(taskRef!.verified).toBe(true);

    // Then evidenceSummary shows verified 2, total 2
    const summary = intentItem!.evidenceSummary;
    expect(summary).toBeDefined();
    expect(summary!.verified).toBe(2);
    expect(summary!.total).toBe(2);
  }, 30_000);
});

// =============================================================================
// M5-3: Evidence summary badge data with verified 2 of 3 total
// =============================================================================
describe("M5-3: Feed item evidenceSummary verified 2 total 3 for badge display", () => {
  it("feed item includes evidenceSummary with verified 2 total 3 when one ref fails verification", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with soft enforcement
    const user = await createTestUser(baseUrl, "m5-evidence-badge");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "fulfillment-coordinator", "agent", workspace.workspaceId);

    // And 3 evidence references: confirmed decision, completed task, and an unverified observation
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Centralize supplier onboarding across all regions",
      status: "confirmed",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Map existing supplier onboarding workflows per region",
      status: "completed",
    });
    const observation = await createEvidenceObservation(surreal, workspace.workspaceId, {
      text: "Three regions still using legacy onboarding forms",
      sourceAgent: "observer-agent",
    });

    // And an intent referencing all 3 as evidence
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Migrate all regions to centralized supplier onboarding portal",
        reasoning: "Decision confirmed and workflows mapped, legacy forms observation noted",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, observation.observationRecord],
      },
    );

    // And evidence_verification showing 2 of 3 verified (observation failed)
    await surreal.query(
      `UPDATE $intent SET evidence_verification = $ev;`,
      {
        intent: new RecordId("intent", intentId),
        ev: {
          verified_count: 2,
          total_count: 3,
          failed_refs: [`observation:${observation.observationId}:not_acknowledged`],
          warnings: [],
          enforcement_mode: "soft",
          tier_met: true,
          verification_time_ms: 12,
        },
      },
    );

    // And the intent is in pending_veto status
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 45,
      reason: "Majority of evidence verified",
    }, "pending_veto");

    // When the governance feed is queried
    const feed = await fetchJson<{ items: Array<GovernanceFeedItem> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then find the intent feed item
    const intentItem = feed.items.find(
      (item) => item.entityKind === "intent" && item.entityId.includes(intentId),
    );
    expect(intentItem).toBeDefined();

    // Then evidenceSummary shows verified 2, total 3
    const summary = intentItem!.evidenceSummary;
    expect(summary).toBeDefined();
    expect(summary!.verified).toBe(2);
    expect(summary!.total).toBe(3);
  }, 30_000);
});

// =============================================================================
// M5-4: Expandable evidence detail with scope_mismatch failure reason
// =============================================================================
describe("M5-4: Feed evidenceRefs show entity type title verification state and failure reason for scope mismatch", () => {
  it("feed item has 3 evidenceRefs where 1 failed ref shows scope_mismatch failure reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with soft enforcement
    const user = await createTestUser(baseUrl, "m5-evidence-detail");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "procurement-optimizer", "agent", workspace.workspaceId);

    // And 2 in-workspace evidence refs (decision + task) and 1 cross-workspace decision
    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Standardize procurement approval workflow across regions",
      status: "confirmed",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Audit regional procurement approval thresholds",
      status: "completed",
    });
    const crossWs = await createDecisionInOtherWorkspace(surreal, {
      summary: "External partner procurement policy update",
      otherWorkspaceName: "Partner Corp",
    });

    // And an intent referencing all 3 as evidence
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Unify procurement approval workflow with partner integration",
        reasoning: "Decision confirmed, audit complete, partner policy referenced",
        evidenceRefs: [decision.decisionRecord, task.taskRecord, crossWs.decisionRecord],
      },
    );

    // And evidence_verification showing 2 verified, 1 failed with scope_mismatch
    await surreal.query(
      `UPDATE $intent SET evidence_verification = $ev;`,
      {
        intent: new RecordId("intent", intentId),
        ev: {
          verified_count: 2,
          total_count: 3,
          failed_refs: [`decision:${crossWs.decisionId}:scope_mismatch`],
          warnings: [],
          enforcement_mode: "soft",
          tier_met: true,
          verification_time_ms: 15,
        },
      },
    );

    // And the intent is in pending_veto status
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 55,
      reason: "Majority evidence verified despite scope mismatch",
    }, "pending_veto");

    // When the governance feed is queried
    const feed = await fetchJson<{ items: Array<GovernanceFeedItem> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then find the intent feed item
    const intentItem = feed.items.find(
      (item) => item.entityKind === "intent" && item.entityId.includes(intentId),
    );
    expect(intentItem).toBeDefined();

    // Then the feed item has evidenceRefs with 3 entries
    const refs = intentItem!.evidenceRefs;
    expect(refs).toBeDefined();
    expect(refs).toBeArrayOfSize(3);

    // Each ref has entityKind, title, verified boolean
    const decisionRef = refs!.find(
      (r) => r.entityKind === "decision" && r.title.includes("Standardize procurement"),
    );
    expect(decisionRef).toBeDefined();
    expect(decisionRef!.verified).toBe(true);

    const taskRef = refs!.find((r) => r.entityKind === "task");
    expect(taskRef).toBeDefined();
    expect(taskRef!.title).toContain("Audit regional procurement");
    expect(taskRef!.verified).toBe(true);

    // The cross-workspace decision failed with scope_mismatch
    const failedRef = refs!.find(
      (r) => r.entityKind === "decision" && r.title.includes("External partner"),
    );
    expect(failedRef).toBeDefined();
    expect(failedRef!.verified).toBe(false);
    expect(failedRef!.failureReason).toBe("scope_mismatch");

    // And evidenceSummary shows verified 2, total 3
    const summary = intentItem!.evidenceSummary;
    expect(summary).toBeDefined();
    expect(summary!.verified).toBe(2);
    expect(summary!.total).toBe(3);
  }, 30_000);
});
