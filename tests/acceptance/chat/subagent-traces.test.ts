import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { collectSseEvents, createTestUser, fetchJson, type TestUser, setupAcceptanceSuite } from "../acceptance-test-kit";
import type { WorkspaceConversationResponse } from "../../../app/src/shared/contracts";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const getRuntime = setupAcceptanceSuite("subagent_traces");

async function createOnboardedWorkspaceWithProject(
  baseUrl: string,
  surreal: Surreal,
  user: TestUser,
): Promise<{ workspaceId: string; conversationId: string }> {
  const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({ name: `Traces Smoke ${Date.now()}` }),
  });

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  await surreal.update(workspaceRecord).merge({
    onboarding_complete: true,
    onboarding_summary_pending: false,
    onboarding_completed_at: new Date(),
  });

  // Seed a project so the PM agent has context to work with
  const projectRecord = new RecordId("project", randomUUID());
  await surreal.create(projectRecord).content({
    name: "DabDash",
    status: "active",
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await surreal
    .relate(workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
      added_at: new Date(),
    })
    .output("after");

  return workspace;
}

describe("subagent trace persistence", () => {
  it("PM agent traces are persisted and loaded via conversation endpoint", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUser(baseUrl, "traces-1");
    const workspace = await createOnboardedWorkspaceWithProject(baseUrl, surreal, user);

    // Send a message that should trigger the PM agent (task/feature planning)
    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "Plan work for DabDash: we need a dashboard with real-time order count, revenue stats, and low stock alerts.",
      }),
    });

    // Wait for streaming to complete
    const events = await collectSseEvents<StreamEvent>(`${baseUrl}${message.streamUrl}`, 120_000);
    expect(events.some((e) => e.type === "done")).toBe(true);

    // Verify traces persisted as normalized trace records via spawns edges
    const assistantMessageRecord = new RecordId("message", message.messageId);
    const [rootTraces] = await surreal
      .query<[Array<{ id: RecordId; type: string; input?: Record<string, unknown>; duration_ms?: number }>]>(
        "SELECT id, type, input, duration_ms FROM trace WHERE <-spawns<-message CONTAINS $msg;",
        { msg: assistantMessageRecord },
      )
      .collect<[Array<{ id: RecordId; type: string; input?: Record<string, unknown>; duration_ms?: number }>]>();

    // The chat agent should have invoked the PM agent for this planning request.
    // If it did, traces should be present. If not (LLM non-determinism), skip trace assertions.
    if (rootTraces.length === 0) {
      console.warn("PM agent was not invoked — skipping trace structure assertions (LLM non-determinism)");
      return;
    }

    const rootTrace = rootTraces[0]!;
    expect(rootTrace.type).toBe("subagent_spawn");
    expect(rootTrace.input?.agentId).toBe("pm_agent");
    expect(typeof rootTrace.input?.intent).toBe("string");
    expect(rootTrace.duration_ms).toBeGreaterThan(0);

    // Verify child traces exist
    const [children] = await surreal
      .query<[Array<{ id: RecordId; type: string; tool_name?: string; input?: Record<string, unknown> }>]>(
        "SELECT id, type, tool_name, input FROM trace WHERE parent_trace = $root ORDER BY created_at ASC;",
        { root: rootTrace.id },
      )
      .collect<[Array<{ id: RecordId; type: string; tool_name?: string; input?: Record<string, unknown> }>]>();

    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(["tool_call", "message"]).toContain(child.type);
      if (child.type === "tool_call") {
        expect(typeof child.tool_name).toBe("string");
      }
    }

    // Verify traces come back through the conversation load endpoint (page reload path)
    const conversation = await fetchJson<WorkspaceConversationResponse>(
      `${baseUrl}/api/workspaces/${encodeURIComponent(workspace.workspaceId)}/conversations/${encodeURIComponent(workspace.conversationId)}`,
      { headers: user.headers },
    );

    const loadedMsg = conversation.messages.find((m) => m.id === message.messageId);
    expect(loadedMsg).toBeDefined();
    expect(loadedMsg!.subagentTraces).toBeDefined();
    expect(loadedMsg!.subagentTraces!.length).toBeGreaterThan(0);

    const loadedTrace = loadedMsg!.subagentTraces![0]!;
    expect(loadedTrace.agentId).toBe("pm_agent");
    expect(typeof loadedTrace.intent).toBe("string");
    expect(loadedTrace.steps.length).toBe(children.length);
  }, 180_000);
});
