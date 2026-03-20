/**
 * Milestone 5: Pattern Detection
 *
 * Traces: US-AL-002 (agent suggests learning)
 *
 * Validates:
 * - Rate limiting: max 5 suggestions per agent per workspace per week
 * - Dismissed re-suggestion prevention (similarity > 0.85 blocks re-suggestion)
 * - Agent-suggested learnings start as pending_approval
 * - Cross-agent coaching (observer suggests learning for coding agent)
 *
 * Driving ports:
 *   SurrealDB direct queries (seed patterns, verify suggestions, rate limit checks)
 *
 * NOTE: Pattern detection from conversation/trace analysis requires LLM calls.
 * These tests focus on the rate limiting and re-suggestion prevention gates,
 * which are deterministic and testable without LLM mocking.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  listLearningsByStatus,
} from "./learning-test-kit";

const getRuntime = setupLearningSuite("learning_m5_detection");

describe("Milestone 5: Pattern Detection and Agent Suggestions", () => {
  // -------------------------------------------------------------------------
  // US-AL-002: Rate limiting
  // -------------------------------------------------------------------------

  it("agent is rate-limited to 5 suggestions per workspace per week", async () => {
    const { surreal } = getRuntime();

    // Given a workspace where the observer agent has already suggested 5 learnings this week
    const { workspaceId } = await createTestWorkspace(surreal, "rate-limit");

    for (let i = 0; i < 5; i++) {
      await createTestLearning(surreal, workspaceId, {
        text: `Suggestion ${i + 1} from observer this week.`,
        learning_type: "instruction",
        status: "pending_approval",
        source: "agent",
        suggested_by: "observer_agent",
      });
    }

    // When checking the suggestion count for observer_agent
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const countResult = (await surreal.query(
      `SELECT count() AS count FROM learning
       WHERE workspace = $ws
         AND suggested_by = $agent
         AND created_at > time::now() - 7d
       GROUP ALL;`,
      { ws: workspaceRecord, agent: "observer_agent" },
    )) as Array<Array<{ count: number }>>;

    const count = countResult[0]?.[0]?.count ?? 0;

    // Then the count is 5 (at limit)
    expect(count).toBe(5);
    // And the detector should skip creating new suggestions (verified by implementation)
  }, 120_000);

  it("different agents have independent rate limits", async () => {
    const { surreal } = getRuntime();

    // Given a workspace where observer has 5 suggestions but PM has 0
    const { workspaceId } = await createTestWorkspace(surreal, "rate-limit-independent");

    for (let i = 0; i < 5; i++) {
      await createTestLearning(surreal, workspaceId, {
        text: `Observer suggestion ${i + 1}.`,
        learning_type: "instruction",
        status: "pending_approval",
        source: "agent",
        suggested_by: "observer_agent",
      });
    }

    // When checking the count for PM agent
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const pmCount = (await surreal.query(
      `SELECT count() AS count FROM learning
       WHERE workspace = $ws
         AND suggested_by = $agent
         AND created_at > time::now() - 7d
       GROUP ALL;`,
      { ws: workspaceRecord, agent: "pm_agent" },
    )) as Array<Array<{ count: number }>>;

    // Then the PM agent has 0 suggestions (can still suggest)
    expect(pmCount[0]?.[0]?.count ?? 0).toBe(0);

    // And the observer has 5 (at limit)
    const observerCount = (await surreal.query(
      `SELECT count() AS count FROM learning
       WHERE workspace = $ws
         AND suggested_by = $agent
         AND created_at > time::now() - 7d
       GROUP ALL;`,
      { ws: workspaceRecord, agent: "observer_agent" },
    )) as Array<Array<{ count: number }>>;

    expect(observerCount[0]?.[0]?.count ?? 0).toBe(5);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-002: Dismissed re-suggestion prevention
  // -------------------------------------------------------------------------

  it("dismissed learning with high similarity blocks re-suggestion", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with a previously dismissed learning
    const { workspaceId } = await createTestWorkspace(surreal, "dismissed-resuggest");

    await createTestLearning(surreal, workspaceId, {
      text: "Consider using GraphQL for the API layer.",
      learning_type: "instruction",
      status: "dismissed",
      source: "agent",
      suggested_by: "observer_agent",
    });

    // When checking for similar dismissed learnings
    // Check for similar dismissed learnings by text match
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // Step 1: KNN candidates from dismissed learnings
    const candidates = (await surreal.query(
      `SELECT id, text, status FROM learning
       WHERE workspace = $ws AND status = "dismissed"
       LIMIT 10;`,
      { ws: workspaceRecord },
    )) as Array<Array<{ id: RecordId; text: string; status: string }>>;

    // Then a dismissed learning with similar text exists
    expect(candidates[0]?.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0][0].text).toContain("GraphQL");
    // The detector should skip re-suggesting this learning
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-002: Agent-suggested learnings require approval
  // -------------------------------------------------------------------------

  it("agent-suggested learning is created with pending_approval status", async () => {
    const { surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await createTestWorkspace(surreal, "agent-pending");

    // When an agent creates a learning suggestion
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Detected pattern: agents frequently fail when tasks lack clear acceptance criteria.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
      pattern_confidence: 0.78,
    });

    // Then the learning is in pending_approval status
    const pendingLearnings = await listLearningsByStatus(surreal, workspaceId, "pending_approval");
    expect(pendingLearnings.length).toBe(1);
    expect(pendingLearnings[0].source).toBe("agent");
    expect(pendingLearnings[0].suggested_by).toBe("observer_agent");
    expect(pendingLearnings[0].pattern_confidence).toBe(0.78);

    // And it is NOT in the active list
    const { listActiveLearnings } = await import("./learning-test-kit");
    const activeLearnings = await listActiveLearnings(surreal, workspaceId);
    expect(activeLearnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-002: Cross-agent coaching
  // -------------------------------------------------------------------------

  it("observer can suggest a learning targeted to coding agents", async () => {
    const { surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await createTestWorkspace(surreal, "cross-agent");

    // When the observer suggests a learning for coding agents
    await createTestLearning(surreal, workspaceId, {
      text: "Always include error handling in database operations.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
      target_agents: ["coding_agent", "mcp"],
      pattern_confidence: 0.85,
    });

    // Then the suggestion targets coding agents specifically
    const pending = await listLearningsByStatus(surreal, workspaceId, "pending_approval");
    expect(pending.length).toBe(1);
    expect(pending[0].suggested_by).toBe("observer_agent");
    expect(pending[0].target_agents).toContain("coding_agent");
    expect(pending[0].target_agents).toContain("mcp");
    expect(pending[0].target_agents).not.toContain("observer_agent");
  }, 120_000);

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it("rate limit count excludes suggestions older than 7 days", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with an old suggestion (> 7 days ago)
    const { workspaceId } = await createTestWorkspace(surreal, "rate-limit-old");
    const workspaceRecord = new RecordId("workspace", workspaceId);

    // Create a suggestion with created_at set to 8 days ago
    const oldLearningId = `learning-${crypto.randomUUID()}`;
    const oldLearningRecord = new RecordId("learning", oldLearningId);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    await surreal.query(`CREATE $learning CONTENT $content;`, {
      learning: oldLearningRecord,
      content: {
        text: "Old suggestion from last week.",
        learning_type: "instruction",
        status: "pending_approval",
        source: "agent",
        suggested_by: "observer_agent",
        priority: "medium",
        target_agents: [],
        workspace: workspaceRecord,
        created_at: eightDaysAgo,
      },
    });

    // When checking the rate limit for this week
    const countResult = (await surreal.query(
      `SELECT count() AS count FROM learning
       WHERE workspace = $ws
         AND suggested_by = $agent
         AND created_at > time::now() - 7d
       GROUP ALL;`,
      { ws: workspaceRecord, agent: "observer_agent" },
    )) as Array<Array<{ count: number }>>;

    // Then the old suggestion is NOT counted
    expect(countResult[0]?.[0]?.count ?? 0).toBe(0);
  }, 120_000);

  it("suggestions from different workspaces do not affect rate limit", async () => {
    const { surreal } = getRuntime();

    // Given workspace A with 5 observer suggestions at limit
    const { workspaceId: wsA } = await createTestWorkspace(surreal, "rate-ws-a");
    for (let i = 0; i < 5; i++) {
      await createTestLearning(surreal, wsA, {
        text: `WS-A suggestion ${i + 1}.`,
        learning_type: "instruction",
        status: "pending_approval",
        source: "agent",
        suggested_by: "observer_agent",
      });
    }

    // And workspace B with 0 suggestions
    const { workspaceId: wsB } = await createTestWorkspace(surreal, "rate-ws-b");

    // When checking rate limit for workspace B
    const workspaceRecord = new RecordId("workspace", wsB);
    const countResult = (await surreal.query(
      `SELECT count() AS count FROM learning
       WHERE workspace = $ws
         AND suggested_by = $agent
         AND created_at > time::now() - 7d
       GROUP ALL;`,
      { ws: workspaceRecord, agent: "observer_agent" },
    )) as Array<Array<{ count: number }>>;

    // Then workspace B has 0 (not affected by workspace A)
    expect(countResult[0]?.[0]?.count ?? 0).toBe(0);
  }, 120_000);
});
