/**
 * Milestone 2: Edit Active Learnings
 *
 * Traces: US-LL-03 (edit/deactivate active learnings)
 *
 * Validates the NEW PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint.
 * This endpoint allows editing text, priority, and target_agents on active learnings.
 *
 * All tests in this file are BLOCKED until the PUT endpoint is implemented.
 * Each test is commented out with the BLOCKED marker. Once the endpoint exists,
 * uncomment tests one at a time following outside-in TDD.
 *
 * Driving ports:
 *   PUT    /api/workspaces/:workspaceId/learnings/:learningId         (edit -- NEW)
 *   GET    /api/workspaces/:workspaceId/learnings                     (verify changes)
 *   SurrealDB direct queries                                         (verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  getLearningById,
  listLearningsViaHttp,
} from "../agent-learnings/learning-test-kit";
import { createTestUser, fetchRaw } from "../acceptance-test-kit";

const getRuntime = setupLearningSuite("learning_library_m2_edit");

/**
 * Helper: sends a PUT request to update a learning.
 * BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
 */
async function editLearningViaHttp(
  baseUrl: string,
  user: { headers: Record<string, string> },
  workspaceId: string,
  learningId: string,
  updates: { text?: string; priority?: string; target_agents?: string[] },
): Promise<Response> {
  return fetchRaw(
    `${baseUrl}/api/workspaces/${workspaceId}/learnings/${learningId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify(updates),
    },
  );
}

describe("Milestone 2: Edit Active Learnings", () => {
  // ---------------------------------------------------------------------------
  // Happy path: edit text
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing the text of an active learning updates the stored text", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-text-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-text");

    // Given: an active learning with original text
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Use tabs for indentation.",
      learning_type: "instruction",
      status: "active",
    });

    // When: user edits the text
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "Use 2-space indentation for all TypeScript files.",
    });

    // Then: the edit succeeds
    expect(response.status).toBe(200);

    // And: the persisted learning has the updated text
    const updated = await getLearningById(surreal, learningId);
    expect(updated!.text).toBe("Use 2-space indentation for all TypeScript files.");
    expect(updated!.updated_at).toBeTruthy();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Happy path: edit priority
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing the priority of an active learning updates the stored priority", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-priority-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-priority");

    // Given: an active learning with medium priority
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Prefer composition over inheritance.",
      learning_type: "instruction",
      status: "active",
      priority: "medium",
    });

    // When: user changes priority to high
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      priority: "high",
    });

    // Then: the priority is updated
    expect(response.status).toBe(200);
    const updated = await getLearningById(surreal, learningId);
    expect(updated!.priority).toBe("high");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Happy path: edit target agents
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing target agents narrows which agents see the learning", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-agents-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-agents");

    // Given: an active learning visible to all agents
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Always run tests before committing.",
      learning_type: "instruction",
      status: "active",
      target_agents: [],
    });

    // When: user restricts it to coding agents only
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      target_agents: ["coding_agent"],
    });

    // Then: the target agents are updated
    expect(response.status).toBe(200);
    const updated = await getLearningById(surreal, learningId);
    expect(updated!.target_agents).toEqual(["coding_agent"]);

    // And: filtering by pm_agent no longer returns this learning
    const pmRes = await listLearningsViaHttp(baseUrl, user, workspaceId, { agent: "pm_agent" });
    const pmBody = (await pmRes.json()) as { learnings: Array<{ text: string }> };
    const found = pmBody.learnings.some((l) => l.text === "Always run tests before committing.");
    expect(found).toBe(false);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Happy path: edit multiple fields at once
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing text and priority together updates both fields", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-multi-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-multi");

    // Given: an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Original text.",
      learning_type: "constraint",
      status: "active",
      priority: "low",
    });

    // When: user edits both text and priority
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "Refined constraint with clearer language.",
      priority: "high",
    });

    // Then: both fields are updated
    expect(response.status).toBe(200);
    const updated = await getLearningById(surreal, learningId);
    expect(updated!.text).toBe("Refined constraint with clearer language.");
    expect(updated!.priority).toBe("high");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Error path: edit non-active learning
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing a pending learning is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-pending-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-pending");

    // Given: a pending learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Pending learning text.",
      learning_type: "instruction",
      status: "pending_approval",
      source: "agent",
    });

    // When: user attempts to edit a non-active learning
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "Trying to edit pending.",
    });

    // Then: the edit is rejected (only active learnings can be edited)
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing a deactivated learning is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-deactivated-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-deactivated");

    // Given: a deactivated learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Deactivated learning text.",
      learning_type: "instruction",
      status: "deactivated",
    });

    // When: user attempts to edit a deactivated learning
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "Trying to revive via edit.",
    });

    // Then: the edit is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing a dismissed learning is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-dismissed-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-dismissed");

    // Given: a dismissed learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Dismissed learning text.",
      learning_type: "instruction",
      status: "dismissed",
    });

    // When: user attempts to edit a dismissed learning
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "Trying to edit dismissed.",
    });

    // Then: the edit is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Error path: validation errors
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing with empty text is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-empty-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-empty");

    // Given: an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Valid learning text.",
      learning_type: "instruction",
      status: "active",
    });

    // When: user attempts to set text to empty string
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "",
    });

    // Then: the edit is rejected with a validation error
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    // And: the original text is preserved
    const unchanged = await getLearningById(surreal, learningId);
    expect(unchanged!.text).toBe("Valid learning text.");
  }, 120_000);

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing with whitespace-only text is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-whitespace-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-whitespace");

    // Given: an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Valid text here.",
      learning_type: "instruction",
      status: "active",
    });

    // When: user attempts to set text to whitespace only
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "   \n\t  ",
    });

    // Then: the edit is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Error path: non-existent learning
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing a non-existent learning returns not found", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-notfound-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-notfound");

    // When: user attempts to edit a learning that does not exist
    const response = await editLearningViaHttp(
      baseUrl,
      user,
      workspaceId,
      `learning-${crypto.randomUUID()}`,
      { text: "Editing a ghost." },
    );

    // Then: a not-found response is returned
    expect(response.status).toBe(404);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Edge case: edit with no changes (empty body)
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("sending an edit with no fields is a no-op or rejected gracefully", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-noop-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-noop");

    // Given: an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Unchanged text.",
      learning_type: "instruction",
      status: "active",
      priority: "medium",
    });

    // When: user sends an edit with no update fields
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {});

    // Then: the request either succeeds as no-op or is rejected gracefully (not 500)
    expect(response.status).toBeLessThan(500);

    // And: the learning is unchanged
    const unchanged = await getLearningById(surreal, learningId);
    expect(unchanged!.text).toBe("Unchanged text.");
    expect(unchanged!.priority).toBe("medium");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Edge case: substantial text edit updates stored text
  // ---------------------------------------------------------------------------

  // BLOCKED: requires PUT /api/workspaces/:workspaceId/learnings/:learningId endpoint
  it("editing text substantially updates the stored text", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, `edit-reembed-${crypto.randomUUID()}`);
    const { workspaceId } = await createTestWorkspace(surreal, "edit-reembed");

    // Given: an active learning
    const { learningId } = await createTestLearning(surreal, workspaceId, {
      text: "Always validate inputs at API boundaries.",
      learning_type: "constraint",
      status: "active",
    });

    // When: user edits the text substantially
    const response = await editLearningViaHttp(baseUrl, user, workspaceId, learningId, {
      text: "Use structured logging with correlation IDs in all services.",
    });

    // Then: the edit succeeds
    expect(response.status).toBe(200);

    // And: the text has been updated
    const after = await getLearningById(surreal, learningId);
    expect(after!.text).toBe("Use structured logging with correlation IDs in all services.");
  }, 120_000);
});
