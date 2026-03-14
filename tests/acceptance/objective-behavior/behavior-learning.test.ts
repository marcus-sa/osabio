/**
 * Observer Behavior Learning Loop Acceptance Tests (US-OB-07)
 *
 * Validates that the Observer Agent detects sustained behavioral
 * underperformance, proposes targeted learnings via the existing
 * learning API, and that the dual-gate safety and collision detection
 * prevent inappropriate proposals.
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId              (graph scan with behavior step)
 *   POST /api/workspaces/:workspaceId/learnings       (learning proposal)
 *   SurrealDB direct queries                          (verification)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObjectiveBehaviorSuite,
  setupObjectiveWorkspace,
  createAgentIdentity,
  createBehaviorTrend,
  createBehaviorRecord,
  getBehaviorRecords,
  getLatestBehaviorScore,
  getWorkspaceObservations,
} from "./objective-behavior-test-kit";
import {
  analyzeTrend,
  type ScorePoint,
} from "../../../app/src/server/behavior/trends";
import {
  queryWorkspaceBehaviorTrends,
  proposeBehaviorLearning,
  checkBehaviorLearningRateLimit,
} from "../../../app/src/server/observer/learning-diagnosis";

const getRuntime = setupObjectiveBehaviorSuite("behavior_learning");

// =============================================================================
// Walking Skeleton: Observer proposes learning for underperforming agent
// =============================================================================
describe("Walking Skeleton: Observer proposes learning from behavior pattern (US-OB-07)", () => {
  it("three consecutive below-threshold sessions produce a detectable behavioral drift pattern", async () => {
    const { surreal } = getRuntime();

    // Given Coder-Beta's Security_First has been below 0.80 for 3 consecutive sessions
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-learning-skel-${crypto.randomUUID()}`,
    );

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Beta",
    );

    // And source telemetry shows CVE advisories being ignored
    const { behaviorIds } = await createBehaviorTrend(
      surreal,
      workspaceId,
      agentId,
      "Security_First",
      [0.62, 0.65, 0.60],
    );

    // When querying behavior records and analyzing the trend
    const records = await getBehaviorRecords(surreal, agentId, "Security_First");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse(); // oldest first for trend analysis

    const trend = analyzeTrend(scorePoints, { threshold: 0.80, minStreakLength: 3 });

    // Then the trend is classified as behavioral drift
    expect(trend.pattern).toBe("drift");
    expect(trend.streakLength).toBeGreaterThanOrEqual(3);
    expect(trend.belowThreshold).toBe(true);
  }, 60_000);
});

// =============================================================================
// Happy Path Scenarios
// =============================================================================
describe("Happy Path: Effective learning detected by Observer (US-OB-07)", () => {
  it("improving behavior scores after learning injection are detectable", async () => {
    const { surreal } = getRuntime();

    // Given Coder-Beta received a learning 5 sessions ago
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-effective-${crypto.randomUUID()}`,
    );

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Beta",
    );

    // And Security_First scores show improvement trend
    await createBehaviorTrend(surreal, workspaceId, agentId, "Security_First", [
      0.70, 0.75, 0.82, 0.85, 0.88,
    ]);

    // When the Observer evaluates the behavior trend
    const records = await getBehaviorRecords(surreal, agentId, "Security_First");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse(); // oldest first

    const trend = analyzeTrend(scorePoints, { threshold: 0.80 });

    // Then the trend is classified as improving
    expect(trend.pattern).toBe("improving");
    expect(trend.belowThreshold).toBe(false);
  }, 60_000);
});

describe("Happy Path: Learning proposed with correct metadata (US-OB-07 #3)", () => {
  it("learning proposal contains correct observer metadata and behavior evidence links", async () => {
    const { surreal } = getRuntime();

    // Given behavior drift is detected for Coder-Beta
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-metadata-${crypto.randomUUID()}`,
    );

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Beta",
    );

    const { behaviorIds } = await createBehaviorTrend(surreal, workspaceId, agentId, "Security_First", [
      0.55, 0.60, 0.58,
    ]);

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When the Observer proposes a learning from the behavior trend
    const result = await proposeBehaviorLearning({
      surreal,
      workspaceRecord,
      identityId: agentId,
      metricType: "Security_First",
      behaviorIds,
      trendPattern: "drift",
      now: new Date(),
    });

    // Then the learning was created
    expect(result.created).toBe(true);

    if (!result.created) return; // type narrowing

    // And the learning has correct observer metadata
    const [rows] = (await surreal.query(
      `SELECT * FROM $learning;`,
      { learning: result.learningRecord },
    )) as [Array<Record<string, unknown>>];

    const learning = rows[0];
    expect(learning.source).toBe("agent");
    expect(learning.suggested_by).toBe("observer");
    expect(learning.status).toBe("pending_approval");
    expect(learning.learning_type).toBe("constraint");

    // And behavior records are linked as learning_evidence
    const [evidenceRows] = (await surreal.query(
      `SELECT * FROM learning_evidence WHERE in = $learning;`,
      { learning: result.learningRecord },
    )) as [Array<{ in: RecordId; out: RecordId }>];

    expect(evidenceRows.length).toBeGreaterThanOrEqual(1);

    // Verify at least one evidence link points to a behavior record
    const behaviorEvidence = evidenceRows.filter(
      (e) => e.out.table.name === "behavior",
    );
    expect(behaviorEvidence.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

// =============================================================================
// Error / Boundary Scenarios
// =============================================================================
describe("Error Path: Ineffective learning surfaced for review (US-OB-07)", () => {
  it("flat behavior scores after learning indicate ineffectiveness", async () => {
    const { surreal } = getRuntime();

    // Given Coder-Delta received a learning 5 sessions ago
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-ineffective-${crypto.randomUUID()}`,
    );

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Delta",
    );

    // And TDD_Adherence scores show no improvement
    await createBehaviorTrend(surreal, workspaceId, agentId, "TDD_Adherence", [
      0.44, 0.45, 0.43, 0.46, 0.45,
    ]);

    // When the Observer evaluates the trend
    const records = await getBehaviorRecords(surreal, agentId, "TDD_Adherence");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse(); // oldest first

    const trend = analyzeTrend(scorePoints, { threshold: 0.70 });

    // Then the trend is classified as flat (ineffective learning)
    expect(trend.pattern).toBe("flat");
    expect(trend.belowThreshold).toBe(true);
  }, 60_000);
});

describe("Boundary: Rate limit prevents excessive learning proposals (US-OB-07 #5)", () => {
  it("rate limit blocks proposal when observer already proposed 5 learnings in 7 days", async () => {
    const { surreal } = getRuntime();

    // Given the Observer has already proposed 5 learnings this week
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-ratelimit-${crypto.randomUUID()}`,
    );

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Alpha",
    );

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // Seed 5 recent observer-proposed learnings
    for (let i = 0; i < 5; i++) {
      const lId = `learning-${crypto.randomUUID()}`;
      await surreal.query(`CREATE $learning CONTENT $content;`, {
        learning: new RecordId("learning", lId),
        content: {
          text: `Observer learning ${i + 1} for rate limit testing`,
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

    // And proposeBehaviorLearning also returns rate_limited
    const { behaviorIds } = await createBehaviorTrend(surreal, workspaceId, agentId, "TDD_Adherence", [
      0.30, 0.35, 0.32,
    ]);

    const proposalResult = await proposeBehaviorLearning({
      surreal,
      workspaceRecord,
      identityId: agentId,
      metricType: "TDD_Adherence",
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

describe("Boundary: Single below-threshold session does not trigger learning (US-OB-07)", () => {
  it("learning requires 3+ consecutive below-threshold sessions, not a single one", async () => {
    const { surreal } = getRuntime();

    // Given Coder-Alpha has only 1 below-threshold session
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-single-${crypto.randomUUID()}`,
    );

    const { identityId: agentId } = await createAgentIdentity(
      surreal,
      workspaceId,
      "Coder-Alpha",
    );

    await createBehaviorRecord(surreal, workspaceId, agentId, {
      metric_type: "TDD_Adherence",
      score: 0.35,
    });

    // When analyzing the trend with insufficient data
    const records = await getBehaviorRecords(surreal, agentId, "TDD_Adherence");
    const scorePoints: ScorePoint[] = records
      .map((r) => ({ score: r.score, timestamp: r.created_at }))
      .reverse();

    const trend = analyzeTrend(scorePoints, { threshold: 0.70, minStreakLength: 3 });

    // Then the pattern is insufficient_data (not enough points for trend detection)
    expect(trend.pattern).toBe("insufficient_data");
    // And no drift is reported despite the low score
    expect(trend.belowThreshold).toBe(false);
  }, 60_000);
});

describe("Happy Path: Behavior trends queried per identity and metric (US-OB-07)", () => {
  it("queryWorkspaceBehaviorTrends returns trends grouped by identity and metric type", async () => {
    const { surreal } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-trends-${crypto.randomUUID()}`,
    );

    const { identityId: agent1 } = await createAgentIdentity(surreal, workspaceId, "Coder-Alpha");
    const { identityId: agent2 } = await createAgentIdentity(surreal, workspaceId, "Coder-Beta");

    // Agent 1: drift in Security_First
    await createBehaviorTrend(surreal, workspaceId, agent1, "Security_First", [0.55, 0.50, 0.48]);

    // Agent 2: stable in TDD_Adherence
    await createBehaviorTrend(surreal, workspaceId, agent2, "TDD_Adherence", [0.85, 0.88, 0.90]);

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // When querying workspace behavior trends
    const trends = await queryWorkspaceBehaviorTrends(surreal, workspaceRecord);

    // Then we get trends grouped per identity+metric
    expect(trends.length).toBeGreaterThanOrEqual(2);

    const driftTrend = trends.find(
      (t) => t.identityId === agent1 && t.metricType === "Security_First",
    );
    expect(driftTrend).toBeDefined();
    expect(driftTrend!.trend.pattern).toBe("drift");

    const stableTrend = trends.find(
      (t) => t.identityId === agent2 && t.metricType === "TDD_Adherence",
    );
    expect(stableTrend).toBeDefined();
    expect(stableTrend!.trend.pattern).toBe("stable");
  }, 60_000);
});

describe("Error Path: Learning collision with active policy (US-OB-07)", () => {
  it.skip("learning blocked when it contradicts an active policy", async () => {
    // Given an active policy contradicts the proposed learning (collision score > 0.40)
    // When the Observer attempts to propose the learning
    // Then the learning is blocked by three-layer collision detection
    // And the Observer creates an observation noting the policy-learning conflict
  });
});
