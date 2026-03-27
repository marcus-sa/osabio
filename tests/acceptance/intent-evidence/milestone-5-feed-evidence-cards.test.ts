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
