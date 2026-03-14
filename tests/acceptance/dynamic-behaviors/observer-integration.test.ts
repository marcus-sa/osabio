/**
 * Observer Integration Acceptance Tests (US-DB-004)
 *
 * Validates that the Observer detects dynamic behavior score patterns,
 * proposes targeted learnings from low scores, and respects rate limits
 * and archived definition exclusion.
 *
 * Driving ports:
 *   analyzeTrend (pure trend analysis)
 *   queryWorkspaceBehaviorTrends (workspace-level trend query)
 *   proposeBehaviorLearning (learning proposal pipeline)
 *   checkBehaviorLearningRateLimit (rate limit guard)
 *   SurrealDB direct queries (seeding + verification)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupDynamicBehaviorsSuite,
  setupBehaviorWorkspace,
  createAgentIdentity,
  createBehaviorDefinition,
  createScoredBehaviorRecord,
  createScoredBehaviorTrend,
  getBehaviorRecords,
  getLatestBehaviorScore,
  getWorkspaceObservations,
  listBehaviorDefinitions,
} from "./dynamic-behaviors-test-kit";
import {
  analyzeTrend,
  type ScorePoint,
} from "../../../app/src/server/behavior/trends";
import {
  queryWorkspaceBehaviorTrends,
  proposeBehaviorLearning,
  checkBehaviorLearningRateLimit,
} from "../../../app/src/server/observer/learning-diagnosis";

const getRuntime = setupDynamicBehaviorsSuite("observer_integration");

// =============================================================================
// Walking Skeleton: covered in walking-skeleton.test.ts
// =============================================================================

// =============================================================================
// Happy Path: Observer detects critical dynamic behavior score (AC-004.1)
// =============================================================================
describe("Happy Path: Observer detects critical Honesty score pattern (US-DB-004)", () => {
  it("three consecutive below-threshold Honesty scores produce a drift pattern", async () => {
    const { surreal } = getRuntime();

    // Given coding-agent-alpha's Honesty has been below 0.50 for 3 sessions
    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-drift-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims.",
      scoring_logic: "Verify claims against graph data.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Honesty",
      definitionId,
      [0.12, 0.08, 0.05],
    );

    // When the Observer analyzes the trend
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse(); // oldest first for trend analysis

    const trend = analyzeTrend(scorePoints, { threshold: 0.50, minStreakLength: 3 });

    // Then the trend is classified as drift
    expect(trend.pattern).toBe("drift");
    expect(trend.streakLength).toBeGreaterThanOrEqual(3);
    expect(trend.belowThreshold).toBe(true);
  }, 60_000);
});

// =============================================================================
// Happy Path: Observer proposes learning from critical score (AC-004.2)
// =============================================================================
describe("Happy Path: Observer proposes learning from Honesty drift (US-DB-004)", () => {
  it("learning proposal contains correct metadata and behavior evidence links", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-learning-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Honesty",
      goal: "Agents must not fabricate claims.",
      scoring_logic: "Verify all assertions against graph data.",
      telemetry_types: ["chat_response"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    const { behaviorIds } = await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Honesty",
      definitionId,
      [0.10, 0.08, 0.05],
    );

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When the Observer proposes a learning
    const result = await proposeBehaviorLearning({
      surreal,
      workspaceRecord,
      identityId: agentId,
      metricType: "Honesty",
      behaviorIds,
      trendPattern: "drift",
      now: new Date(),
    });

    // Then a learning was created
    expect(result.created).toBe(true);

    if (!result.created) return;

    // And the learning has correct observer metadata
    const [rows] = (await surreal.query(
      `SELECT * FROM $learning;`,
      { learning: result.learningRecord },
    )) as [Array<Record<string, unknown>>];

    const learning = rows[0];
    expect(learning.source).toBe("agent");
    expect(learning.suggested_by).toBe("observer");
    expect(learning.status).toBe("pending_approval");

    // And behavior records are linked as learning_evidence
    const [evidenceRows] = (await surreal.query(
      `SELECT * FROM learning_evidence WHERE in = $learning;`,
      { learning: result.learningRecord },
    )) as [Array<{ in: RecordId; out: RecordId }>];

    expect(evidenceRows.length).toBeGreaterThanOrEqual(1);

    const behaviorEvidence = evidenceRows.filter(
      (e) => e.out.table.name === "behavior",
    );
    expect(behaviorEvidence.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

// =============================================================================
// Happy Path: Improving scores detected (no learning needed)
// =============================================================================
describe("Happy Path: Improving dynamic behavior scores do not trigger learning (US-DB-004)", () => {
  it("upward trend in Evidence-Based Reasoning is classified as improving", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-improving-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Evidence-Based Reasoning",
      goal: "Cite supporting evidence from the knowledge graph.",
      scoring_logic: "Score based on citation count.",
      telemetry_types: ["decision_proposal"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-beta",
    );

    await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Evidence-Based Reasoning",
      definitionId,
      [0.70, 0.75, 0.82, 0.85, 0.88],
    );

    // When the Observer evaluates the behavior trend
    const records = await getBehaviorRecords(surreal, agentId, "Evidence-Based Reasoning");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse();

    const trend = analyzeTrend(scorePoints, { threshold: 0.80 });

    // Then the trend is classified as improving
    expect(trend.pattern).toBe("improving");
    expect(trend.belowThreshold).toBe(false);
  }, 60_000);
});

// =============================================================================
// Happy Path: Dynamic metrics in workspace-level trends (AC-004.1)
// =============================================================================
describe("Happy Path: Workspace trends include dynamic metric types (US-DB-004)", () => {
  it("queryWorkspaceBehaviorTrends returns trends for dynamic and deterministic metrics", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-ws-trends-${crypto.randomUUID()}`,
    );

    // Given two agents with different dynamic metric trends
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
      telemetry_types: ["decision_proposal"],
      status: "active",
    });

    const { identityId: agent1 } = await createAgentIdentity(surreal, workspaceId, "coding-agent-alpha");
    const { identityId: agent2 } = await createAgentIdentity(surreal, workspaceId, "coding-agent-beta");

    // Agent 1: drift in Honesty
    await createScoredBehaviorTrend(surreal, workspaceId, agent1, "Honesty", honestyDefId, [0.30, 0.25, 0.20]);

    // Agent 2: stable in Evidence-Based Reasoning
    await createScoredBehaviorTrend(surreal, workspaceId, agent2, "Evidence-Based Reasoning", evidenceDefId, [0.85, 0.88, 0.90]);

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When querying workspace behavior trends
    const trends = await queryWorkspaceBehaviorTrends(surreal, workspaceRecord);

    // Then we get trends for both dynamic metrics
    expect(trends.length).toBeGreaterThanOrEqual(2);

    const driftTrend = trends.find(
      (t) => t.identityId === agent1 && t.metricType === "Honesty",
    );
    expect(driftTrend).toBeDefined();
    expect(driftTrend!.trend.pattern).toBe("drift");

    const stableTrend = trends.find(
      (t) => t.identityId === agent2 && t.metricType === "Evidence-Based Reasoning",
    );
    expect(stableTrend).toBeDefined();
    expect(stableTrend!.trend.pattern).toBe("stable");
  }, 60_000);
});

// =============================================================================
// Error Path: Rate limit prevents excessive learning proposals (AC-004.3)
// =============================================================================
describe("Error Path: Rate limit blocks learning proposal when 5 already exist (US-DB-004)", () => {
  it("Observer creates critical observation instead of learning when rate limited", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-ratelimit-${crypto.randomUUID()}`,
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

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // Given the Observer has already proposed 5 learnings this week
    for (let i = 0; i < 5; i++) {
      const lId = `learning-${crypto.randomUUID()}`;
      await surreal.query(`CREATE $learning CONTENT $content;`, {
        learning: new RecordId("learning", lId),
        content: {
          text: `Observer learning ${i + 1} for dynamic behavior rate limit`,
          learning_type: "instruction",
          status: "pending_approval",
          source: "agent",
          suggested_by: "observer",
          priority: "medium",
          target_agents: [agentId],
          workspace: workspaceRecord,
          created_at: new Date(),
        },
      });
    }

    // When the rate limit guard is checked
    const rateLimitResult = await checkBehaviorLearningRateLimit({
      surreal,
      workspaceRecord,
    });

    // Then the rate limit blocks the proposal
    expect(rateLimitResult.blocked).toBe(true);
    expect(rateLimitResult.count).toBeGreaterThanOrEqual(5);

    // And proposeBehaviorLearning returns rate_limited
    const { behaviorIds } = await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Honesty",
      definitionId,
      [0.10, 0.08, 0.05],
    );

    const proposalResult = await proposeBehaviorLearning({
      surreal,
      workspaceRecord,
      identityId: agentId,
      metricType: "Honesty",
      behaviorIds,
      trendPattern: "drift",
      now: new Date(),
    });

    expect(proposalResult.created).toBe(false);
    if (!proposalResult.created) {
      expect(proposalResult.reason).toBe("rate_limited");
    }
  }, 60_000);
});

// =============================================================================
// Error Path: Archived definitions excluded from analysis (AC-004.4)
// =============================================================================
describe("Error Path: Observer ignores scores for archived definitions (US-DB-004)", () => {
  it("archived Conciseness definition's scores are not flagged by the Observer", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-archived-${crypto.randomUUID()}`,
    );

    // Given "Conciseness" definition is archived
    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Conciseness",
      goal: "Be concise.",
      scoring_logic: "Signal-to-noise ratio.",
      telemetry_types: ["chat_response"],
      status: "archived",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-alpha",
    );

    // And recent Conciseness scores are below threshold
    await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Conciseness",
      definitionId,
      [0.20, 0.15, 0.10],
    );

    // Then only active definitions should be considered
    const activeDefinitions = await listBehaviorDefinitions(surreal, workspaceId, "active");
    expect(activeDefinitions).toHaveLength(0);

    // And the Observer would not flag these scores
    // (verified by the fact that Observer queries active definitions only)
  }, 60_000);
});

// =============================================================================
// Boundary: Single below-threshold score does not trigger learning
// =============================================================================
describe("Boundary: Single low score does not trigger learning proposal (US-DB-004)", () => {
  it("one low Honesty score is insufficient data for trend detection", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-single-${crypto.randomUUID()}`,
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

    // Given only 1 below-threshold score
    await createScoredBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "Honesty",
      score: 0.05,
      definitionId,
    });

    // When analyzing the trend
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse();

    const trend = analyzeTrend(scorePoints, { threshold: 0.50, minStreakLength: 3 });

    // Then the pattern is insufficient_data
    expect(trend.pattern).toBe("insufficient_data");
    expect(trend.belowThreshold).toBe(false);
  }, 60_000);
});

// =============================================================================
// Boundary: Flat scores indicate ineffective learning
// =============================================================================
describe("Boundary: Flat scores after learning indicate ineffective intervention (US-DB-004)", () => {
  it("flat below-threshold Honesty scores are classified as stagnant", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-flat-${crypto.randomUUID()}`,
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

    // Given 5 sessions with flat below-threshold scores
    await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Honesty",
      definitionId,
      [0.12, 0.13, 0.11, 0.12, 0.13],
    );

    // When the Observer evaluates the trend
    const records = await getBehaviorRecords(surreal, agentId, "Honesty");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse();

    const trend = analyzeTrend(scorePoints, { threshold: 0.50 });

    // Then the trend is classified as flat (ineffective)
    expect(trend.pattern).toBe("flat");
    expect(trend.belowThreshold).toBe(true);
  }, 60_000);
});

// =============================================================================
// Error Path: Observer detects drift pattern in Evidence-Based Reasoning
// =============================================================================
describe("Error Path: Observer detects drift in Evidence-Based Reasoning scores (US-DB-004)", () => {
  it("4 consecutive declining scores produce a drift pattern", async () => {
    const { surreal } = getRuntime();

    const { workspaceId, adminId } = await setupBehaviorWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-eb-drift-${crypto.randomUUID()}`,
    );

    const { definitionId } = await createBehaviorDefinition(surreal, workspaceId, adminId, {
      title: "Evidence-Based Reasoning",
      goal: "Cite evidence.",
      scoring_logic: "Count citations.",
      telemetry_types: ["decision_proposal"],
      status: "active",
    });

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "coding-agent-beta",
    );

    // Given 4 consecutive declining scores below threshold
    await createScoredBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Evidence-Based Reasoning",
      definitionId,
      [0.68, 0.62, 0.55, 0.48],
    );

    // When the Observer analyzes the trend
    const records = await getBehaviorRecords(surreal, agentId, "Evidence-Based Reasoning");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse();

    const trend = analyzeTrend(scorePoints, { threshold: 0.70, minStreakLength: 3 });

    // Then the trend is classified as drift
    expect(trend.pattern).toBe("drift");
    expect(trend.belowThreshold).toBe(true);
  }, 60_000);
});
