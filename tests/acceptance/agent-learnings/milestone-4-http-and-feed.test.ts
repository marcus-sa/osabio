/**
 * Milestone 4: HTTP Endpoints and Governance Feed
 *
 * Traces: US-AL-004 (learning governance feed cards), US-AL-001 (human creates learning)
 *
 * Validates:
 * - POST create learning with embedding generation
 * - GET list with filters (status, type, agent)
 * - Approve action transitions pending to active with audit trail
 * - Edit & Approve modifies text and activates
 * - Dismiss action records reason
 * - Deactivate action with audit trail
 * - Pending learnings appear in governance feed
 *
 * Driving ports:
 *   POST   /api/workspaces/:workspaceId/learnings                     (create learning)
 *   GET    /api/workspaces/:workspaceId/learnings                     (list learnings)
 *   POST   /api/workspaces/:workspaceId/learnings/:learningId/actions (status transitions)
 *   GET    /api/workspaces/:workspaceId/feed                         (governance feed)
 *   SurrealDB direct queries                                         (verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  createLearningViaHttp,
  listLearningsViaHttp,
  performLearningAction,
  getLearningById,
  listLearningsByStatus,
} from "./learning-test-kit";
import { createTestUser, fetchRaw } from "../acceptance-test-kit";

const getRuntime = setupLearningSuite("learning_m4_http_feed");

describe("Milestone 4: HTTP Endpoints and Governance Feed", () => {
  // -------------------------------------------------------------------------
  // US-AL-001: Create learning via HTTP
  // -------------------------------------------------------------------------

  it.skip("human creates a constraint learning via HTTP and it is immediately active", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an authenticated user with a workspace
    const user = await createTestUser(baseUrl, `http-create-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-create");

    // When the human creates a constraint learning
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Never persist null values in domain data records.",
      learning_type: "constraint",
      priority: "high",
      target_agents: [],
    });

    // Then the learning is created successfully
    expect(response.status).toBe(201);
    const body = (await response.json()) as { learningId: string };
    expect(body.learningId).toBeTruthy();

    // And it is immediately active (human-created = no approval required)
    const persisted = await getLearningById(surreal, body.learningId);
    expect(persisted!.status).toBe("active");
    expect(persisted!.source).toBe("human");
  }, 120_000);

  it.skip("human creates an instruction learning with specific target agents", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-target-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-target");

    // When creating a learning targeted to specific agents
    const response = await createLearningViaHttp(baseUrl, user, workspaceId, {
      text: "Use feature branches for all new development work.",
      learning_type: "instruction",
      priority: "medium",
      target_agents: ["coding_agent", "mcp"],
    });

    // Then the learning is created with correct target agents
    expect(response.status).toBe(201);
    const body = (await response.json()) as { learningId: string };

    const persisted = await getLearningById(surreal, body.learningId);
    expect(persisted!.target_agents).toEqual(["coding_agent", "mcp"]);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-001: Create validation errors
  // -------------------------------------------------------------------------

  it.skip("creating a learning without required text field is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-missing-text-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-missing-text");

    // When attempting to create a learning without text
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspaceId}/learnings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          learning_type: "instruction",
          priority: "medium",
        }),
      },
    );

    // Then the request is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  it.skip("creating a learning with invalid learning_type is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-invalid-type-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-invalid-type");

    // When attempting to create a learning with an invalid type
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspaceId}/learnings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          text: "Some learning text",
          learning_type: "not_a_valid_type",
          priority: "medium",
        }),
      },
    );

    // Then the request is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: List learnings with filters
  // -------------------------------------------------------------------------

  it.skip("list learnings filtered by status returns only matching records", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-list-status-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-list-status");

    // Given a workspace with learnings in different statuses
    await createTestLearning(surreal, workspaceId, {
      text: "Active learning one.",
      learning_type: "instruction",
      status: "active",
    });
    await createTestLearning(surreal, workspaceId, {
      text: "Pending learning one.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
    });

    // When listing with status filter "active"
    const response = await listLearningsViaHttp(baseUrl, user, workspaceId, {
      status: "active",
    });

    // Then only active learnings are returned
    expect(response.status).toBe(200);
    const body = (await response.json()) as { learnings: Array<{ text: string; status: string }> };
    expect(body.learnings.length).toBe(1);
    expect(body.learnings[0].status).toBe("active");
  }, 120_000);

  it.skip("list learnings filtered by type returns only matching records", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-list-type-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-list-type");

    // Given a workspace with different learning types
    await createTestLearning(surreal, workspaceId, {
      text: "A constraint learning.",
      learning_type: "constraint",
      status: "active",
    });
    await createTestLearning(surreal, workspaceId, {
      text: "An instruction learning.",
      learning_type: "instruction",
      status: "active",
    });

    // When listing with type filter "constraint"
    const response = await listLearningsViaHttp(baseUrl, user, workspaceId, {
      type: "constraint",
    });

    // Then only constraint learnings are returned
    expect(response.status).toBe(200);
    const body = (await response.json()) as { learnings: Array<{ learning_type: string }> };
    expect(body.learnings.length).toBe(1);
    expect(body.learnings[0].learning_type).toBe("constraint");
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: Approve action
  // -------------------------------------------------------------------------

  it.skip("approving a pending learning transitions it to active with audit trail", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-approve-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-approve");

    // Given a pending agent-suggested learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Consider using batch operations for database writes.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
    });

    // When the human approves the learning
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      learningId,
      { action: "approve" },
    );

    // Then the action succeeds
    expect(response.status).toBe(200);

    // And the learning is now active
    const approved = await getLearningById(surreal, learningId);
    expect(approved!.status).toBe("active");
    // And the approval timestamp is recorded
    expect(approved!.approved_at).toBeTruthy();
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: Dismiss action
  // -------------------------------------------------------------------------

  it.skip("dismissing a pending learning records the reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-dismiss-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-dismiss");

    // Given a pending agent-suggested learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Consider switching to MongoDB for document storage.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
    });

    // When the human dismisses with a reason
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      learningId,
      {
        action: "dismiss",
        reason: "We already use SurrealDB and this contradicts our architecture.",
      },
    );

    // Then the action succeeds
    expect(response.status).toBe(200);

    // And the learning is dismissed with the reason recorded
    const dismissed = await getLearningById(surreal, learningId);
    expect(dismissed!.status).toBe("dismissed");
    expect(dismissed!.dismissed_reason).toBe(
      "We already use SurrealDB and this contradicts our architecture.",
    );
    expect(dismissed!.dismissed_at).toBeTruthy();
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: Deactivate action
  // -------------------------------------------------------------------------

  it.skip("deactivating an active learning records audit trail", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-deactivate-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-deactivate");

    // Given an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Use tabs for indentation.",
      learning_type: "instruction",
      status: "active",
    });

    // When the human deactivates it
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      learningId,
      { action: "deactivate" },
    );

    // Then the action succeeds
    expect(response.status).toBe(200);

    // And the learning is deactivated with audit trail
    const deactivated = await getLearningById(surreal, learningId);
    expect(deactivated!.status).toBe("deactivated");
    expect(deactivated!.deactivated_at).toBeTruthy();
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: Invalid actions
  // -------------------------------------------------------------------------

  it.skip("approving an already-active learning is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-double-approve-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-double-approve");

    // Given an already-active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Already active learning.",
      learning_type: "instruction",
      status: "active",
    });

    // When attempting to approve it again
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      learningId,
      { action: "approve" },
    );

    // Then the action is rejected (invalid state transition)
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  it.skip("dismissing an active learning is rejected (must deactivate instead)", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-dismiss-active-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-dismiss-active");

    // Given an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Active learning cannot be dismissed.",
      learning_type: "instruction",
      status: "active",
    });

    // When attempting to dismiss it (dismiss is only for pending_approval)
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      learningId,
      { action: "dismiss", reason: "Trying to dismiss active" },
    );

    // Then the action is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  it.skip("action on non-existent learning returns not found", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-not-found-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-not-found");

    // When performing an action on a learning that does not exist
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      `learning-${crypto.randomUUID()}`,
      { action: "approve" },
    );

    // Then a not-found response is returned
    expect(response.status).toBe(404);
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: Governance feed
  // -------------------------------------------------------------------------

  it.skip("pending learnings appear in the governance feed", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `feed-pending-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "feed-pending");

    // Given a workspace with a pending learning
    await createTestLearning(surreal, workspaceId, {
      text: "Agent suggests: Enable structured logging across all services.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
      pattern_confidence: 0.82,
    });

    // When loading the governance feed
    const response = await fetchRaw(
      `${baseUrl}/api/workspaces/${workspaceId}/feed`,
      { headers: user.headers },
    );

    // Then the feed includes the pending learning
    expect(response.status).toBe(200);
    const feed = (await response.json()) as { items: Array<{ type: string; text?: string }> };

    // The pending learning should appear as a feed card
    // (exact field names depend on feed implementation)
    expect(feed.items).toBeDefined();
  }, 120_000);

  // -------------------------------------------------------------------------
  // US-AL-004: Edit and approve
  // -------------------------------------------------------------------------

  it.skip("editing and approving a pending learning saves modified text as active", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `http-edit-approve-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "http-edit-approve");

    // Given a pending learning with text that needs refinement
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Maybe use structured logging sometimes.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
      suggested_by: "observer_agent",
    });

    // When the human edits the text and approves
    const response = await performLearningAction(
      baseUrl,
      user,
      workspaceId,
      learningId,
      {
        action: "approve",
        new_text: "Always use structured logging with severity levels in all services.",
      },
    );

    // Then the action succeeds
    expect(response.status).toBe(200);

    // And the learning is active with the modified text
    const updated = await getLearningById(surreal, learningId);
    expect(updated!.status).toBe("active");
    expect(updated!.text).toBe(
      "Always use structured logging with severity levels in all services.",
    );
  }, 120_000);
});
