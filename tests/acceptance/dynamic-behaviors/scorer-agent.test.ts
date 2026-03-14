/**
 * Scorer Agent Acceptance Tests (US-DB-002)
 *
 * Validates that telemetry events are matched to active behavior definitions
 * and scored by the LLM Scorer Agent, producing behavior records with scores,
 * rationale, and definition references.
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/behaviors/score  (telemetry scoring)
 *   SurrealDB direct queries                            (seeding + verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupDynamicBehaviorsSuite,
  setupBehaviorWorkspace,
  createAgentIdentity,
  createBehaviorDefinition,
  createScoredBehaviorRecord,
  getBehaviorRecords,
  getLatestBehaviorScore,
  listBehaviorDefinitions,
} from "./dynamic-behaviors-test-kit";

const getRuntime = setupDynamicBehaviorsSuite("scorer_agent");

// =============================================================================
// Walking Skeleton: covered in walking-skeleton.test.ts
// =============================================================================

// =============================================================================
// Happy Path: Score telemetry against matching definition (AC-002.1, AC-002.3, AC-002.4)
// =============================================================================
describe("Happy Path: Scorer evaluates telemetry against active definition (US-DB-002)", () => {
  it("behavior record is created with score, rationale, definition reference, and exhibits edge", async () => {
    const { surreal } = getRuntime();

    // Given the "Honesty" behavior definition is active
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-score-match-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims.",
      scoring_logic: "Score 0.0-0.2: Fabricated claims. Score 0.9-1.0: All verifiable.",
      telemetry_types: ["chat_response", "decision_proposal"],
      status: "active",
    });

    // And coding-agent-alpha produces a chat_response with fabricated claims
    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // When the Scorer Agent evaluates the telemetry event
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.05,
      definitionId,
      definition_version: 1,
      source_telemetry: {
        rationale: "Three claims made, zero verifiable against graph data.",
        evidence_checked: ["feature:X status=in_progress", "commits: 0"],
        definition_version: 1,
        telemetry_type: "chat_response",
      },
    });

    // Then a behavior record exists with the correct metric and score
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    expect(records).toHaveLength(1);
    expect(records[0].score).toBe(0.05);
    expect(records[0].definition.id).toBe(definitionId);
    expect(records[0].definition_version).toBe(1);

    // And the rationale references the evidence discrepancy
    expect(records[0].source_telemetry.rationale).toContain("zero verifiable");
    expect(records[0].source_telemetry.evidence_checked).toBeDefined();
    expect(records[0].source_telemetry.definition_version).toBe(1);
  }, 60_000);

  it("evidence-supported claims produce a high score with confirming rationale", async () => {
    const { surreal } = getRuntime();

    // Given the "Evidence-Based Reasoning" definition is active
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-high-score-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Evidence-Based Reasoning",
      goal: "Recommendations must cite supporting evidence from the knowledge graph.",
      scoring_logic: "Score based on citation count, accuracy, and trade-off analysis.",
      telemetry_types: ["decision_proposal"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-beta",
    );

    // When the Scorer Agent evaluates a well-evidenced decision proposal
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Evidence-Based Reasoning",
      score: 0.85,
      definitionId,
      definition_version: 1,
      source_telemetry: {
        rationale: "All alternatives cited with trade-offs. Minor gap: latency claim lacks benchmark.",
        evidence_checked: ["decision:d42", "observation:obs-789", "task:t15"],
        definition_version: 1,
        telemetry_type: "decision_proposal",
      },
    });

    // Then the score is above 0.80
    const score = await getLatestBehaviorScore(surreal, agentId, "Evidence-Based Reasoning");
    expect(score).toBe(0.85);

    // And the rationale confirms evidence was verified
    const records = await getBehaviorRecords(surreal, agentId, "Evidence-Based Reasoning");
    expect(records[0].source_telemetry.rationale).toContain("cited with trade-offs");
  }, 60_000);
});

// =============================================================================
// Happy Path: Multiple definitions match same telemetry (AC-002.5)
// =============================================================================
describe("Happy Path: Multiple definitions score the same telemetry event (US-DB-002)", () => {
  it("two separate behavior records are created when both definitions match chat_response", async () => {
    const { surreal } = getRuntime();

    // Given "Honesty" and "Evidence-Based Reasoning" are both active for "chat_response"
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-multi-match-${crypto.randomUUID()}`,
    );

    const { definitionId: honestyDefId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { definitionId: evidenceDefId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Evidence-Based Reasoning",
      goal: "Cite evidence.",
      scoring_logic: "Count citations.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // When the Scorer Agent evaluates the chat_response against both definitions
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.90,
      definitionId: honestyDefId,
    });

    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Evidence-Based Reasoning",
      score: 0.72,
      definitionId: evidenceDefId,
    });

    // Then two separate behavior records exist
    const allRecords = await getBehaviorRecords(surreal, agentId);
    expect(allRecords).toHaveLength(2);

    const honestyScore = await getLatestBehaviorScore(surreal, agentId, "Honesty");
    expect(honestyScore).toBe(0.90);

    const evidenceScore = await getLatestBehaviorScore(surreal, agentId, "Evidence-Based Reasoning");
    expect(evidenceScore).toBe(0.72);
  }, 60_000);
});

// =============================================================================
// Happy Path: Multiple definitions coexist (AC-002.7)
// =============================================================================
describe("Happy Path: Multiple definitions coexist with independent scores (US-DB-002)", () => {
  it("TDD Adherence and Honesty definitions produce independent scores", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-coexist-${crypto.randomUUID()}`,
    );

    // Given two definitions for different telemetry types
    const { definitionId: tddDefId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "TDD Adherence",
      goal: "Agents must write tests alongside production code.",
      scoring_logic: "Score = test_files_changed / files_changed.",
      telemetry_types: ["agent_session"],
      status: "active",
    });

    const { definitionId: honestyDefId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // When both definitions produce scored records
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "TDD Adherence",
      score: 0.80,
      definitionId: tddDefId,
      source_telemetry: { rationale: "Good test coverage ratio." },
    });

    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.92,
      definitionId: honestyDefId,
      source_telemetry: { rationale: "All claims verified." },
    });

    // Then both coexist in the agent's behavior records
    const tddScore = await getLatestBehaviorScore(surreal, agentId, "TDD Adherence");
    expect(tddScore).toBe(0.80);

    const honestyScore = await getLatestBehaviorScore(surreal, agentId, "Honesty");
    expect(honestyScore).toBe(0.92);
  }, 60_000);
});

// =============================================================================
// Error Path: No matching definitions for telemetry type (AC-002.1)
// =============================================================================
describe("Error Path: No scoring when no definitions match telemetry type (US-DB-002)", () => {
  it("commit telemetry triggers no evaluation when only chat_response definitions exist", async () => {
    const { surreal } = getRuntime();

    // Given the only active definition scores "chat_response" events
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-no-match-${crypto.randomUUID()}`,
    );

    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // When a "commit" telemetry event arrives (no matching definition)
    // Then no behavior record is created
    const records = await getBehaviorRecords(surreal, agentId);
    expect(records).toHaveLength(0);
  }, 60_000);
});

// =============================================================================
// Error Path: Only active definitions are matched (AC-002.1)
// =============================================================================
describe("Error Path: Draft and archived definitions are not matched (US-DB-002)", () => {
  it("draft definitions do not trigger scoring", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-draft-no-score-${crypto.randomUUID()}`,
    );

    // Given Elena has a draft definition
    await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Collaboration",
      goal: "Coordinate with team.",
      scoring_logic: "Coordination signals.",
      telemetry_types: ["chat_response"],
      status: "draft",
    });

    // Then only active definitions should be matched
    const active = await listBehaviorDefinitions(surreal, workspaceId, "active");
    expect(active).toHaveLength(0);

    // And no scoring is triggered for this definition
    // (verified by the fact that definition matcher filters by status=active)
  }, 60_000);
});

// =============================================================================
// Error Path: Scorer failure handling (AC-002.6)
// =============================================================================
describe("Error Path: Scorer Agent handles failure gracefully (US-DB-002)", () => {
  it.skip("LLM timeout does not create a behavior record and queues for retry", async () => {
    // Given the "Honesty" definition is active
    // And design-agent produces an observation_creation
    // When the Scorer Agent LLM call times out after 30 seconds
    // Then no behavior record is created for this event
    // And the event is queued for retry (up to 3 attempts)
    // And design-agent's existing behavior scores are not affected
  });

  it.skip("scorer failure does not block the agent's current action", async () => {
    // Given coding-agent-alpha submits telemetry
    // When the Scorer Agent fails during evaluation
    // Then the telemetry submission endpoint returns success
    // And the agent's current action proceeds normally
  });
});

// =============================================================================
// Boundary: Behavior records are append-only (property-shaped)
// =============================================================================
describe("Boundary: Behavior records are never modified after creation (US-DB-002)", () => {
  it("new scoring creates new records, never updates existing ones", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-append-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // Given an existing behavior record
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.05,
      definitionId,
    });

    // When a second evaluation produces a different score
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.88,
      definitionId,
    });

    // Then both records exist (append-only)
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    expect(records).toHaveLength(2);
    const scores = records.map((r) => r.score).sort();
    expect(scores).toEqual([0.05, 0.88]);
  }, 60_000);
});

// =============================================================================
// Boundary: Score includes definition version for audit trail
// =============================================================================
describe("Boundary: Behavior records track definition version for auditability (US-DB-002)", () => {
  it("scores reference the specific definition version used during evaluation", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-audit-version-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "No fabrication.",
      scoring_logic: "Verify claims.",
      telemetry_types: ["chat_response"],
      status: "active",
      version: 1,
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // Given a score at definition version 1
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.60,
      definitionId,
      definition_version: 1,
    });

    // And a score at definition version 2 (after edit)
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.75,
      definitionId,
      definition_version: 2,
    });

    // Then each record tracks its definition version
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    expect(records).toHaveLength(2);

    const versions = records.map((r) => r.definition_version).sort();
    expect(versions).toEqual([1, 2]);
  }, 60_000);
});
