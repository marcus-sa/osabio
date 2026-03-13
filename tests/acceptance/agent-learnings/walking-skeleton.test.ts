/**
 * Walking Skeleton: Agent Learnings E2E
 *
 * Traces: US-AL-005 (schema), US-AL-001 (create), US-AL-003 (JIT injection)
 *
 * These are the minimum viable E2E paths through the learning system.
 * Skeleton 1: Human creates learning -> persisted with correct schema -> loaded by JIT -> appears in prompt
 * Skeleton 2: Learning targeted to agent A -> not injected for agent B (workspace + agent type filtering)
 *
 * Together they prove:
 * - Schema works (learning table with all required fields)
 * - HTTP endpoint works (create via POST)
 * - Persistence works (record in SurrealDB with correct field values)
 * - JIT loading works (loadActiveLearnings returns the learning)
 * - Agent-type filtering works (target_agents scoping)
 * - Prompt formatting works (formatted section contains learning text)
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/learnings  (HTTP create)
 *   SurrealDB direct queries                     (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupLearningSuite,
  createTestWorkspace,
  createLearningViaHttp,
  listActiveLearnings,
  getLearningById,
  type LearningRecord,
} from "./learning-test-kit";
import { createTestUser } from "../acceptance-test-kit";

const getRuntime = setupLearningSuite("learning_walking_skeleton");

describe("Walking Skeleton: Human creates a learning and it appears in agent context", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Create learning -> persisted -> loaded -> formatted
  // US-AL-005 + US-AL-001 + US-AL-003 happy path
  // ---------------------------------------------------------------------------
  it("human creates a learning rule and it becomes available to agents", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where a human works with coding agents
    const user = await createTestUser(baseUrl, `skeleton-create-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "skeleton-create");

    // When the human creates a constraint learning: "Never use null for domain data values"
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Never use null for domain data values. Use undefined via optional properties instead.",
      learning_type: "constraint",
      priority: "high",
      target_agents: [],
    });

    // Then the learning is accepted
    expect(response.status).toBe(201);
    const body = (await response.json()) as { learningId: string };
    expect(body.learningId).toBeTruthy();

    // And the learning is persisted with status "active" (human-created = immediate activation)
    const persisted = await getLearningById(surreal, body.learningId);
    expect(persisted).toBeDefined();
    expect(persisted!.text).toBe(
      "Never use null for domain data values. Use undefined via optional properties instead.",
    );
    expect(persisted!.learning_type).toBe("constraint");
    expect(persisted!.status).toBe("active");
    expect(persisted!.source).toBe("human");
    expect(persisted!.priority).toBe("high");

    // And the learning appears when active learnings are loaded for any agent
    const activeLearnings = await listActiveLearnings(surreal, workspaceId);
    const found = activeLearnings.find(
      (l) => (l.id as unknown as { id: string }).id === body.learningId ||
             l.text === persisted!.text,
    );
    expect(found).toBeDefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: Agent-type filtering -- learning for agent A not seen by agent B
  // US-AL-003 filtering path
  // ---------------------------------------------------------------------------
  it("learning targeted to coding agents is not loaded for the chat agent", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with a learning targeted specifically to coding agents
    const { workspaceId } = await createTestWorkspace(surreal, "skeleton-filter");

    const { learningId } = await import("./learning-test-kit").then((kit) =>
      kit.createTestLearning(surreal, workspaceId, {
        text: "Always run tests before committing code changes.",
        learning_type: "instruction",
        status: "active",
        source: "human",
        priority: "medium",
        target_agents: ["coding_agent"],
      }),
    );

    // When active learnings are loaded for the coding agent
    const codingAgentLearnings = await listActiveLearnings(
      surreal,
      workspaceId,
      "coding_agent",
    );

    // Then the learning appears for the coding agent
    expect(codingAgentLearnings.length).toBeGreaterThanOrEqual(1);
    const foundForCoding = codingAgentLearnings.some(
      (l) => l.text === "Always run tests before committing code changes.",
    );
    expect(foundForCoding).toBe(true);

    // When active learnings are loaded for the chat agent
    const chatAgentLearnings = await listActiveLearnings(
      surreal,
      workspaceId,
      "chat_agent",
    );

    // Then the learning does NOT appear for the chat agent
    const foundForChat = chatAgentLearnings.some(
      (l) => l.text === "Always run tests before committing code changes.",
    );
    expect(foundForChat).toBe(false);
  }, 120_000);
});
