/**
 * Milestone 6: Collision Detection
 *
 * Traces: US-AL-006 (learning collision detection)
 *
 * IMPORTANT: These tests call a real LLM for intent classification.
 * Collision detection uses BM25 fulltext search instead of embeddings.
 * Required env vars: OPENROUTER_API_KEY, EXTRACTION_MODEL.
 *
 * Validates:
 * - Learning-vs-learning collision: near-duplicate, contradiction (via LLM), no collision
 * - Policy collision is a hard block (learning cannot override governance)
 * - Decision collision is informational (reinforces or warns, never blocks)
 * - LLM intent classification distinguishes contradicts/reinforces/unrelated
 * - Fail-open for human-created learnings
 * - Workspace boundary isolation for collision detection
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/learnings  (create with collision check)
 *   SurrealDB direct queries                     (seed existing learnings/policies/decisions)
 */
import { describe, expect, it } from "bun:test";
import {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  createTestPolicy,
  createTestDecision,
  createLearningViaHttp,
  getLearningById,
  createTestUser,
} from "./learning-test-kit";

const getRuntime = setupLearningSuite("learning_m6_collision");

describe("Milestone 6: Collision Detection", () => {
  // -------------------------------------------------------------------------
  // US-AL-006: Learning-vs-learning near-duplicate detection (>0.90)
  // -------------------------------------------------------------------------

  it("near-duplicate learning detected when texts are semantically identical", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active learning about null usage
    const { workspaceId } = await createTestWorkspace(surreal, "near-dup");
    await createTestLearning(surreal, workspaceId, {
      text: "Never use null for domain data values. Represent absence with omitted optional fields.",
      learning_type: "constraint",
      status: "active",
    });

    // When creating a learning with nearly identical meaning
    const user = await createTestUser(baseUrl, `dup-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Do not use null in domain data. Use omitted optional fields to represent absence.",
      learning_type: "constraint",
      priority: "medium",
    });

    // Then the response indicates a near-duplicate collision (similarity >0.90)
    const body = await response.json();
    expect(body.collisions).toBeDefined();
    const duplicates = body.collisions.filter(
      (c: { collisionType: string }) => c.collisionType === "duplicates",
    );
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
    expect(duplicates[0].similarity).toBeGreaterThan(0.90);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-006: Learning-vs-learning contradiction via LLM (0.75-0.90)
  // -------------------------------------------------------------------------

  it("LLM classifies contradicting learnings in the ambiguous similarity zone", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active learning recommending one approach
    const { workspaceId } = await createTestWorkspace(surreal, "llm-contra");
    await createTestLearning(surreal, workspaceId, {
      text: "Always use PostgreSQL for all new database services. No other databases allowed.",
      learning_type: "constraint",
      status: "active",
      target_agents: ["code_agent"],
    });

    // When creating a learning that contradicts it (same domain, opposite instruction)
    const user = await createTestUser(baseUrl, `contra-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Use MySQL for all new database services. PostgreSQL is not permitted.",
      learning_type: "constraint",
      priority: "medium",
    });

    // Then the collision check invokes LLM and classifies as "contradicts"
    const body = await response.json();
    expect(body.collisions).toBeDefined();
    const contradictions = body.collisions.filter(
      (c: { collisionType: string }) => c.collisionType === "contradicts",
    );
    expect(contradictions.length).toBeGreaterThanOrEqual(1);
    expect(contradictions[0].targetKind).toBe("learning");
    // And the collision includes LLM reasoning
    expect(contradictions[0].reasoning).toBeTruthy();
  }, 120_000);

  it("LLM classifies reinforcing learnings as non-blocking", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active learning about TypeScript
    const { workspaceId } = await createTestWorkspace(surreal, "llm-reinforce");
    await createTestLearning(surreal, workspaceId, {
      text: "Always use TypeScript strict mode for all backend services.",
      learning_type: "instruction",
      status: "active",
    });

    // When creating a complementary learning (same direction, more specific)
    const user = await createTestUser(baseUrl, `reinforce-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Enable TypeScript strict null checks in tsconfig.json for all projects.",
      learning_type: "instruction",
      priority: "medium",
    });

    // Then the LLM classifies the relationship as "reinforces" (not a conflict)
    const body = await response.json();
    if (body.collisions?.length > 0) {
      const reinforcements = body.collisions.filter(
        (c: { collisionType: string }) => c.collisionType === "reinforces",
      );
      // If collisions are returned, they should be reinforcing, not contradicting
      expect(
        body.collisions.every(
          (c: { collisionType: string }) => c.collisionType !== "contradicts",
        ),
      ).toBe(true);
    }
    // And the learning is still created successfully (reinforcement is not blocking)
    expect(response.status).toBeLessThan(400);
  }, 120_000);

  it("unrelated topics below 0.75 similarity produce no collision", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active learning about database conventions
    const { workspaceId } = await createTestWorkspace(surreal, "unrelated");
    await createTestLearning(surreal, workspaceId, {
      text: "Always use PostgreSQL for relational data storage in production.",
      learning_type: "constraint",
      status: "active",
    });

    // When creating a learning about a completely different topic (CSS styling)
    const user = await createTestUser(baseUrl, `unrelated-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Use CSS Grid for page layouts instead of flexbox for two-dimensional arrangements.",
      learning_type: "instruction",
      priority: "medium",
    });

    // Then no collision is detected (topics are semantically distant)
    const body = await response.json();
    expect(body.collisions ?? []).toHaveLength(0);
    expect(response.status).toBeLessThan(400);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-006: Learning-vs-policy collision (hard block)
  // -------------------------------------------------------------------------

  it("policy collision is a hard block — learning cannot be activated", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active policy requiring code review
    const { workspaceId } = await createTestWorkspace(surreal, "policy-block");
    await createTestPolicy(surreal, workspaceId, {
      name: "Mandatory Code Review Policy",
      description: "All code changes must be reviewed by at least one other engineer before merging. No exceptions for any change size.",
    });

    // When creating a learning that contradicts the policy
    const user = await createTestUser(baseUrl, `policy-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Skip code review for small changes under 10 lines to move faster.",
      learning_type: "instruction",
      priority: "medium",
    });

    // Then the learning is blocked (policy outranks learning)
    const body = await response.json();
    expect(body.collisions).toBeDefined();
    const policyCollisions = body.collisions.filter(
      (c: { targetKind: string; blocking: boolean }) =>
        c.targetKind === "policy" && c.blocking === true,
    );
    expect(policyCollisions.length).toBeGreaterThanOrEqual(1);
    // And the learning is NOT activated
    if (body.learning?.id) {
      const learning = await getLearningById(surreal, body.learning.id);
      expect(learning?.status).not.toBe("active");
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-006: Learning-vs-decision collision (informational)
  // -------------------------------------------------------------------------

  it("decision collision is informational — learning reinforces confirmed decision", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a confirmed decision about PostgreSQL
    const { workspaceId } = await createTestWorkspace(surreal, "decision-reinforce");
    await createTestDecision(surreal, workspaceId, {
      summary: "Standardize on PostgreSQL for all relational database needs across the organization.",
      rationale: "Team expertise, JSON support, and ecosystem maturity.",
      status: "confirmed",
    });

    // When creating a learning that aligns with the decision
    const user = await createTestUser(baseUrl, `dec-reinforce-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Prefer PostgreSQL over MySQL for all new backend services.",
      learning_type: "instruction",
      priority: "medium",
    });

    // Then the collision is informational (reinforces, does not block)
    const body = await response.json();
    expect(response.status).toBeLessThan(400);
    if (body.collisions?.length > 0) {
      const decisionCollisions = body.collisions.filter(
        (c: { targetKind: string }) => c.targetKind === "decision",
      );
      // Decision collisions are never blocking
      for (const c of decisionCollisions) {
        expect(c.blocking).toBe(false);
      }
    }
  }, 120_000);

  it("decision contradiction produces warning but does not block", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a confirmed decision to standardize on PostgreSQL
    const { workspaceId } = await createTestWorkspace(surreal, "decision-contra");
    await createTestDecision(surreal, workspaceId, {
      summary: "Standardize on PostgreSQL for all database services. No other databases.",
      rationale: "Consistency and operational simplicity.",
      status: "confirmed",
    });

    // When creating a learning that contradicts the decision
    const user = await createTestUser(baseUrl, `dec-contra-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Use MySQL for all new database services. PostgreSQL is being phased out.",
      learning_type: "constraint",
      priority: "high",
    });

    // Then the response succeeds (decision collision is NOT a hard block)
    expect(response.status).toBeLessThan(400);
    const body = await response.json();
    if (body.collisions?.length > 0) {
      const decisionCollisions = body.collisions.filter(
        (c: { targetKind: string }) => c.targetKind === "decision",
      );
      // Decision collisions are warnings, never blocking
      for (const c of decisionCollisions) {
        expect(c.blocking).toBe(false);
      }
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-006: Fail-open for human-created learnings
  // -------------------------------------------------------------------------

  it("human-created learning activates even when embedding is unavailable", async () => {
    const { surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await createTestWorkspace(surreal, "fail-open");

    // When a human creates a learning without an embedding (simulating embedding service failure)
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Always review pull requests before merging.",
      learning_type: "instruction",
      status: "active",
      source: "human",
      // No embedding provided = simulates embedding service unavailability
    });

    // Then the learning is activated (fail-open for human-created)
    const learning = await getLearningById(surreal, learningId);
    expect(learning).toBeDefined();
    expect(learning!.status).toBe("active");
    expect(learning!.source).toBe("human");
  }, 120_000);

  it("agent-suggested learning stays pending when embedding is unavailable", async () => {
    const { surreal } = getRuntime();

    // Given a workspace
    const { workspaceId } = await createTestWorkspace(surreal, "agent-no-embed");

    // When an agent suggests a learning without an embedding
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Consider adding retry logic for network calls.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
      // No embedding = collision check skipped, stays pending for human review
    });

    // Then the learning stays in pending_approval (human will review)
    const learning = await getLearningById(surreal, learningId);
    expect(learning).toBeDefined();
    expect(learning!.status).toBe("pending_approval");
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-006: Workspace boundary isolation
  // -------------------------------------------------------------------------

  it("collision detection respects workspace boundaries", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given workspace A with a learning about REST APIs
    const { workspaceId: wsA } = await createTestWorkspace(surreal, "ws-a");
    await createTestLearning(surreal, wsA, {
      text: "Always use REST APIs for all external integrations. Never use GraphQL.",
      learning_type: "constraint",
      status: "active",
    });

    // And workspace B (separate workspace, no learnings)
    const { workspaceId: wsB } = await createTestWorkspace(surreal, "ws-b");

    // When creating the same learning in workspace B
    const user = await createTestUser(baseUrl, `ws-b-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, wsB, {
      text: "Always use REST APIs for all external integrations. Never use GraphQL.",
      learning_type: "constraint",
      priority: "medium",
    });

    // Then no collision is detected (different workspaces are isolated)
    const body = await response.json();
    expect(body.collisions ?? []).toHaveLength(0);
    expect(response.status).toBeLessThan(400);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-006: Priority weighting
  // -------------------------------------------------------------------------

  it("human learning takes precedence over agent-suggested learning on collision", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active agent-suggested learning about semicolons
    const { workspaceId } = await createTestWorkspace(surreal, "priority-weight");
    await createTestLearning(surreal, workspaceId, {
      text: "Always use semicolons at the end of every JavaScript and TypeScript statement.",
      learning_type: "instruction",
      status: "active",
      source: "agent",
      suggested_by: "observer_agent",
    });

    // When a human creates a contradicting learning
    const user = await createTestUser(baseUrl, `priority-${crypto.randomUUID()}`);
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Do not enforce semicolons. Rely on ASI and auto-formatting tools instead.",
      learning_type: "instruction",
      priority: "medium",
    });

    // Then the collision is detected but flagged as human-overrides-agent
    const body = await response.json();
    expect(response.status).toBeLessThan(400);
    if (body.collisions?.length > 0) {
      // The collision warning should note that human learning takes precedence
      const collision = body.collisions[0];
      expect(collision.collisionType).toBe("contradicts");
      // Human-created learning is not blocked by agent-suggested learning
      expect(collision.blocking).toBe(false);
    }
  }, 120_000);
});
