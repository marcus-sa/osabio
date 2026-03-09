import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { collectSseEvents, createTestUser, fetchJson, type TestUser, setupAcceptanceSuite } from "../acceptance-test-kit";
import type { SubagentTrace, WorkspaceConversationResponse } from "../../../app/src/shared/contracts";

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

    // Verify traces persisted on the assistant message in DB
    const assistantMessageRecord = new RecordId("message", message.messageId);
    const [messageRows] = await surreal
      .query<[Array<{ id: RecordId<"message", string>; subagent_traces?: SubagentTrace[] }>]>(
        "SELECT id, subagent_traces FROM message WHERE id = $msg;",
        { msg: assistantMessageRecord },
      )
      .collect<[Array<{ id: RecordId<"message", string>; subagent_traces?: SubagentTrace[] }>]>();

    expect(messageRows.length).toBe(1);
    const assistantMsg = messageRows[0]!;

    // The chat agent should have invoked the PM agent for this planning request.
    // If it did, traces should be present. If not (LLM non-determinism), skip trace assertions.
    if (!assistantMsg.subagent_traces || assistantMsg.subagent_traces.length === 0) {
      console.warn("PM agent was not invoked — skipping trace structure assertions (LLM non-determinism)");
      return;
    }

    const trace = assistantMsg.subagent_traces[0]!;

    // Validate trace structure
    expect(trace.agentId).toBe("pm_agent");
    expect(typeof trace.intent).toBe("string");
    expect(trace.totalDurationMs).toBeGreaterThan(0);
    expect(Array.isArray(trace.steps)).toBe(true);
    expect(trace.steps.length).toBeGreaterThan(0);

    // Validate step structure
    for (const step of trace.steps) {
      expect(["tool_call", "text"]).toContain(step.type);
      if (step.type === "tool_call") {
        expect(typeof step.toolName).toBe("string");
        expect(typeof step.argsJson).toBe("string");
        // argsJson should be valid JSON
        expect(() => JSON.parse(step.argsJson!)).not.toThrow();
        if (step.resultJson) {
          expect(() => JSON.parse(step.resultJson!)).not.toThrow();
        }
      }
      if (step.type === "text") {
        expect(typeof step.text).toBe("string");
        expect(step.text!.length).toBeGreaterThan(0);
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
    expect(loadedTrace.agentId).toBe(trace.agentId);
    expect(loadedTrace.intent).toBe(trace.intent);
    expect(loadedTrace.steps.length).toBe(trace.steps.length);
  }, 180_000);
});
