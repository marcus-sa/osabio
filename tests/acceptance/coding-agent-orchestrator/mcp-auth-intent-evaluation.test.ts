/**
 * MCP Auth Bootstrap: Intent must be evaluated before token exchange.
 *
 * Regression guard:
 * - Assignment must not fail with pending_auth.
 * - Orchestrator bootstrap intent must include an evaluation record.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("mcp_auth_intent_eval");

describe("Orchestrator MCP auth bootstrap intent", () => {
  it("evaluates pending_auth before exchanging token", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, `mcp-auth-${randomUUID()}`);
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Regression: orchestrator bootstrap intent evaluation",
      status: "ready",
    });

    await assignTaskToAgent(baseUrl, user, workspace.workspaceId, task.taskId);

    const [rows] = await surreal.query<
      [Array<{ status: string; goal: string; reasoning: string; created_at: Date; evaluation?: { evaluated_at?: Date } }>]
    >(
      `SELECT status, goal, reasoning, created_at, evaluation FROM intent
       WHERE workspace = $workspace
       ORDER BY created_at DESC
       LIMIT 1;`,
      {
        workspace: new RecordId("workspace", workspace.workspaceId),
      },
    );
    const intent = rows[0];

    expect(intent).toBeTruthy();
    expect(intent?.goal.startsWith("Complete task:")).toBeTrue();
    expect(intent?.reasoning.toLowerCase().includes("complete task")).toBeTrue();
    expect(intent?.status).toBe("authorized");
    expect(intent?.evaluation).toBeTruthy();
    expect(intent?.evaluation?.evaluated_at).toBeTruthy();
  }, 60_000);
});
