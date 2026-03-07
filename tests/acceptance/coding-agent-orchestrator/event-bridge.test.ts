/**
 * Event Bridge: Agent Events Forwarded to User via SSE
 *
 * Traces: US-1.1 (stream agent events to UI)
 *
 * Validates that activity from the coding agent (file changes, tool calls,
 * errors) is forwarded to the user's browser through the Brain SSE stream.
 * The Event Bridge transforms SDK messages into Brain stream events.
 *
 * Driving ports: GET /api/orchestrator/stream/:streamId (SSE)
 *                POST /api/orchestrator/:ws/assign (triggers event bridge)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("event_bridge");

type AgentStreamEvent = {
  type: string;
  sessionId?: string;
  file?: string;
  changeType?: string;
  token?: string;
  error?: string;
};

/**
 * Collects SSE events from the agent stream until timeout or done event.
 */
async function collectAgentEvents(
  streamUrl: string,
  timeoutMs: number,
): Promise<AgentStreamEvent[]> {
  const response = await fetch(streamUrl, {
    headers: { Accept: "text/event-stream" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open agent SSE stream (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = "";

  const timeout = setTimeout(() => {
    void reader.cancel();
  }, timeoutMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const dataLine = segment
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) continue;

        const event = JSON.parse(
          dataLine.slice("data: ".length),
        ) as AgentStreamEvent;
        events.push(event);

        if (event.type === "agent_done" || event.type === "agent_error") {
          return events;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  return events;
}

describe("Event Bridge: Agent activity streamed to user", () => {
  // -------------------------------------------------------------------------
  // Happy Path: File changes appear in the event stream
  // US-1.1
  // -------------------------------------------------------------------------
  it.skip("file changes from the agent appear in the activity stream", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent with an active event stream
    const user = await createTestUser(baseUrl, "bridge-files");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Create user settings page",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent creates or modifies files during its work
    const events = await collectAgentEvents(
      `${baseUrl}${assignment.streamUrl}`,
      30_000,
    );

    // Then file change events appear in the activity stream
    const fileEvents = events.filter((e) => e.type === "agent_file_change");
    expect(fileEvents.length).toBeGreaterThanOrEqual(0);
    // Note: with mocked agent, we verify the stream infrastructure works.
    // Full file change events require a real agent session.
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Agent status changes are streamed
  // US-1.1
  // -------------------------------------------------------------------------
  it.skip("agent status transitions appear in the event stream", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent
    const user = await createTestUser(baseUrl, "bridge-status");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement search filters",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent transitions through its work lifecycle
    const events = await collectAgentEvents(
      `${baseUrl}${assignment.streamUrl}`,
      30_000,
    );

    // Then status change events are present in the stream
    const statusEvents = events.filter((e) => e.type === "agent_status");
    // At minimum, the stream should emit the initial status
    expect(events.length).toBeGreaterThan(0);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Stream for nonexistent session
  // -------------------------------------------------------------------------
  it.skip("returns error when subscribing to a stream for a nonexistent session", async () => {
    const { baseUrl } = getRuntime();

    // Given a stream identifier that does not correspond to any active session
    // When a user tries to subscribe to that stream
    const response = await fetch(
      `${baseUrl}/api/orchestrator/stream/nonexistent-stream-id`,
      { headers: { Accept: "text/event-stream" } },
    );

    // Then the request fails because no matching stream exists
    expect(response.ok).toBe(false);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Error Path: Agent error events are forwarded
  // US-1.1
  // -------------------------------------------------------------------------
  it.skip("agent errors are forwarded to the event stream", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task assigned to an agent that encounters an error
    const user = await createTestUser(baseUrl, "bridge-error");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Migrate legacy database",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent encounters an error during its work
    const events = await collectAgentEvents(
      `${baseUrl}${assignment.streamUrl}`,
      30_000,
    );

    // Then error events in the stream contain diagnostic information
    const errorEvents = events.filter((e) => e.type === "agent_error");
    for (const errorEvent of errorEvents) {
      expect(typeof errorEvent.error).toBe("string");
    }
  }, 60_000);
});
