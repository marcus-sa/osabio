/**
 * Milestone 6: Evidence Drill-Down -- Entity Detail for Evidence Types
 *
 * Validates:
 * - Entity detail endpoint accepts evidence entity types (observation, policy, learning, git_commit, intent)
 * - Previously, the entity detail handler only accepted a subset of entity types
 *
 * Driving ports:
 *   GET /api/entities/:entityId?workspaceId=:ws (entity detail)
 *   SurrealDB direct (entity creation)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import type {
  GovernanceFeedItem,
} from "../../../app/src/shared/contracts";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createEvidenceObservation,
  createEvidenceLearning,
  createEvidenceGitCommit,
  createIntentWithEvidence,
  setWorkspaceEnforcementMode,
  simulateEvaluation,
  wireIntentEvaluationEvent,
  fetchJson,
  type OrchestratorTestRuntime,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m6");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireIntentEvaluationEvent(surreal, port);
});

// =============================================================================
// M6-1: Entity detail accepts observation table
// =============================================================================
describe("M6-1: Entity detail for evidence entity types", () => {
  it("accepts observation entityId and returns entity detail", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an observation
    const user = await createTestUser(baseUrl, "m6-evidence-drill");
    const workspace = await createTestWorkspace(baseUrl, user);

    const observation = await createEvidenceObservation(
      surreal,
      workspace.workspaceId,
      {
        text: "Supply chain lead times increasing in APAC region",
        sourceAgent: "observer-agent",
        severity: "warning",
      },
    );

    // When entity detail is requested for the observation
    const entityId = `observation:${observation.observationId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    // Then the response is successful
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.entity).toBeDefined();
    expect(body.entity.kind).toBe("observation");
    expect(body.entity.name).toContain("Supply chain lead times");
  });
});

// =============================================================================
// M6-2: Feed resolves learning and git_commit evidence ref names
// =============================================================================
describe("M6-2: Feed resolves learning and git_commit evidence ref names", () => {
  it("resolves learning text and git_commit message as evidence ref titles in feed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with soft enforcement
    const user = await createTestUser(baseUrl, "m6-name-resolution");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    const agentId = await createTestIdentity(surreal, "compliance-auditor", "agent", workspace.workspaceId);

    // And a learning and git_commit exist as evidence entities
    const learning = await createEvidenceLearning(surreal, workspace.workspaceId, {
      text: "Regulatory filings must include quarterly revenue breakdown",
    });
    const gitCommit = await createEvidenceGitCommit(surreal, workspace.workspaceId, {
      message: "feat(compliance): add quarterly revenue breakdown to filing template",
    });

    // And an intent references both as evidence
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Submit Q1 regulatory filing with revenue breakdown",
        reasoning: "Learning requires breakdown, commit implements template",
        evidenceRefs: [learning.learningRecord, gitCommit.commitRecord],
      },
    );

    // When evaluation puts the intent in pending_veto
    await simulateEvaluation(surreal, intentId, {
      decision: "APPROVE",
      risk_score: 30,
      reason: "Evidence supports filing readiness",
    }, "pending_veto");

    // And the governance feed is queried
    const feed = await fetchJson<{ items: Array<GovernanceFeedItem> }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then find the intent feed item
    const intentItem = feed.items.find(
      (item) => item.entityKind === "intent" && item.entityId.includes(intentId),
    );
    expect(intentItem).toBeDefined();

    // Then the feed item has evidenceRefs with resolved titles
    const refs = intentItem!.evidenceRefs;
    expect(refs).toBeDefined();
    expect(refs!.length).toBe(2);

    // Learning ref resolves to its text field
    const learningRef = refs!.find((r) => r.entityKind === "learning");
    expect(learningRef).toBeDefined();
    expect(learningRef!.title).toBe("Regulatory filings must include quarterly revenue breakdown");

    // Git commit ref resolves to its message field
    const gitCommitRef = refs!.find((r) => r.entityKind === "git_commit");
    expect(gitCommitRef).toBeDefined();
    expect(gitCommitRef!.title).toBe("feat(compliance): add quarterly revenue breakdown to filing template");
  });
});
