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
  EntityDetailResponse,
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
  createEvidenceDecision,
  createEvidenceTask,
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

// =============================================================================
// M6-3: Entity detail response builders for observation, learning, git_commit
// =============================================================================
describe("M6-3: Entity detail response includes entity-specific fields", () => {
  it("returns observation-specific fields in the detail payload", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an observation that has all typed fields
    const user = await createTestUser(baseUrl, "m6-obs-fields");
    const workspace = await createTestWorkspace(baseUrl, user);

    const observation = await createEvidenceObservation(
      surreal,
      workspace.workspaceId,
      {
        text: "Vendor delivery SLA breach detected in Southeast Asia corridor",
        sourceAgent: "supply-chain-monitor",
        severity: "conflict",
      },
    );

    // When entity detail is requested for the observation
    const entityId = `observation:${observation.observationId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    expect(response.status).toBe(200);

    const body: EntityDetailResponse = await response.json();

    // Then the response includes observation-specific fields in entity.data
    expect(body.entity.kind).toBe("observation");
    expect(body.entity.data.text).toBe("Vendor delivery SLA breach detected in Southeast Asia corridor");
    expect(body.entity.data.severity).toBe("conflict");
    expect(body.entity.data.status).toBe("open");
    expect(body.entity.data.source_agent).toBe("supply-chain-monitor");
  });

  it("returns learning-specific fields in the detail payload", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a learning
    const user = await createTestUser(baseUrl, "m6-learn-fields");
    const workspace = await createTestWorkspace(baseUrl, user);

    const learning = await createEvidenceLearning(surreal, workspace.workspaceId, {
      text: "Customs clearance requires advance filing 72 hours before arrival",
      learningType: "constraint",
    });

    // When entity detail is requested for the learning
    const entityId = `learning:${learning.learningId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    expect(response.status).toBe(200);

    const body: EntityDetailResponse = await response.json();

    // Then the response includes learning-specific fields in entity.data
    expect(body.entity.kind).toBe("learning");
    expect(body.entity.data.text).toBe("Customs clearance requires advance filing 72 hours before arrival");
    expect(body.entity.data.learning_type).toBe("constraint");
    expect(body.entity.data.status).toBe("active");
    expect(body.entity.data.source).toBe("human");
  });

  it("returns git_commit-specific fields in the detail payload", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a git_commit
    const user = await createTestUser(baseUrl, "m6-commit-fields");
    const workspace = await createTestWorkspace(baseUrl, user);

    const gitCommit = await createEvidenceGitCommit(surreal, workspace.workspaceId, {
      message: "fix(logistics): correct duty calculation for cross-border shipments",
      sha: "abc123def456789012345678901234567890abcd",
      repository: "supply-chain/logistics-engine",
    });

    // When entity detail is requested for the git_commit
    const entityId = `git_commit:${gitCommit.commitId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    expect(response.status).toBe(200);

    const body: EntityDetailResponse = await response.json();

    // Then the response includes git_commit-specific fields in entity.data
    expect(body.entity.kind).toBe("git_commit");
    expect(body.entity.data.message).toBe("fix(logistics): correct duty calculation for cross-border shipments");
    expect(body.entity.data.sha).toBe("abc123def456789012345678901234567890abcd");
    expect(body.entity.data.author_name).toBeDefined();
    expect(body.entity.data.repository).toBe("supply-chain/logistics-engine");
  });
});

// =============================================================================
// M6-4: EntityDetailPanel renders evidence entity kinds (API shape validation)
// =============================================================================
describe("M6-4: Entity detail for intent entity kind", () => {
  it("returns intent-specific fields (goal, status, action_type) in the detail payload", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an intent
    const user = await createTestUser(baseUrl, "m6-intent-detail");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "logistics-planner", "agent", workspace.workspaceId);

    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Reroute shipments through alternate port due to congestion",
        reasoning: "Port congestion at primary hub exceeds 72-hour threshold",
        evidenceRefs: [],
      },
    );

    // When entity detail is requested for the intent
    const entityId = `intent:${intentId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    // Then the response is successful with intent-specific fields
    expect(response.status).toBe(200);

    const body: EntityDetailResponse = await response.json();
    expect(body.entity.kind).toBe("intent");
    expect(body.entity.data.goal).toBe("Reroute shipments through alternate port due to congestion");
    expect(body.entity.data.status).toBeDefined();
  });
});

// =============================================================================
// M6-5: Entity detail resolves evidence ref names for intents
// =============================================================================
describe("M6-5: Entity detail resolves evidence ref names for intents", () => {
  it("returns evidence_refs as objects with table, id, and resolved name", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a decision and a task
    const user = await createTestUser(baseUrl, "m6-evidence-names");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentId = await createTestIdentity(surreal, "compliance-agent", "agent", workspace.workspaceId);

    const decision = await createEvidenceDecision(surreal, workspace.workspaceId, {
      summary: "Standardize on event sourcing for audit trail",
    });
    const task = await createEvidenceTask(surreal, workspace.workspaceId, {
      title: "Implement quarterly revenue reconciliation",
    });

    // And an intent referencing both as evidence
    const { intentId } = await createIntentWithEvidence(
      surreal, workspace.workspaceId, agentId,
      {
        goal: "Run quarterly compliance audit with full evidence chain",
        reasoning: "Decision and task provide compliance backing",
        evidenceRefs: [decision.decisionRecord, task.taskRecord],
      },
    );

    // When entity detail is requested for the intent
    const entityId = `intent:${intentId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    // Then the response is successful
    expect(response.status).toBe(200);

    const body: EntityDetailResponse = await response.json();

    // And evidence_refs are resolved objects with table, id, and name
    const refs = body.entity.data.evidence_refs as Array<{ table: string; id: string; name: string }>;
    expect(refs).toBeDefined();
    expect(refs.length).toBe(2);

    const decisionRef = refs.find((r) => r.table === "decision");
    expect(decisionRef).toBeDefined();
    expect(decisionRef!.id).toBe(decision.decisionId);
    expect(decisionRef!.name).toBe("Standardize on event sourcing for audit trail");

    const taskRef = refs.find((r) => r.table === "task");
    expect(taskRef).toBeDefined();
    expect(taskRef!.id).toBe(task.taskId);
    expect(taskRef!.name).toBe("Implement quarterly revenue reconciliation");
  });
});
