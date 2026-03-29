/**
 * Unit tests for SandboxAgent event bridge translation.
 *
 * Pure transform functions tested with concrete input/output pairs.
 * No real SDK, no SurrealDB, no SSE registry -- stubs for all effects.
 *
 * Events use real ACP JSON-RPC envelope format (SessionEvent from SDK).
 *
 * Traces: US-03 (event bridge)
 *
 * Driving port: Event bridge translation functions (pure)
 */
import { describe, expect, it } from "bun:test";
import {
  translateSessionEvent,
  createSandboxEventBridge,
  type SandboxEventBridgeDeps,
} from "../../../app/src/server/orchestrator/sandbox-event-bridge";
import type { SessionEvent } from "../../../app/src/server/orchestrator/sandbox-adapter";
import type { StreamEvent } from "../../../app/src/shared/contracts";

// ── Helpers: create real ACP SessionEvent envelopes ──

let eventCounter = 0;

function makeSessionEvent(
  sessionId: string,
  payload: Record<string, unknown>,
): SessionEvent {
  eventCounter++;
  return {
    id: `evt-${eventCounter}`,
    eventIndex: eventCounter,
    sessionId,
    createdAt: Date.now(),
    connectionId: "conn-test",
    sender: "agent" as const,
    payload: payload as any,
  };
}

function toolCallEvent(sessionId: string, toolName: string): SessionEvent {
  return makeSessionEvent(sessionId, {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        name: toolName,
        toolCallId: `tc-${crypto.randomUUID().slice(0, 8)}`,
      },
    },
  });
}

function textChunkEvent(sessionId: string, text: string): SessionEvent {
  return makeSessionEvent(sessionId, {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function resultEvent(sessionId: string): SessionEvent {
  return makeSessionEvent(sessionId, {
    jsonrpc: "2.0",
    result: { stopReason: "end_turn" },
  });
}

function unknownUpdateEvent(sessionId: string): SessionEvent {
  return makeSessionEvent(sessionId, {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configId: "model",
        value: "claude-4",
      },
    },
  });
}

// ── Stub event bridge deps ──

function stubBridgeDeps(): SandboxEventBridgeDeps & {
  emitted: Array<{ streamId: string; event: StreamEvent }>;
  updatedSessions: string[];
  statusUpdates: Array<{ sessionId: string; status: string; error?: string }>;
  stallNotifications: string[];
} {
  const emitted: Array<{ streamId: string; event: StreamEvent }> = [];
  const updatedSessions: string[] = [];
  const statusUpdates: Array<{ sessionId: string; status: string; error?: string }> = [];
  const stallNotifications: string[] = [];
  return {
    emitEvent: (streamId, event) => {
      emitted.push({ streamId, event });
    },
    updateLastEventAt: async (sessionId) => {
      updatedSessions.push(sessionId);
    },
    updateSessionStatus: async (sessionId, status, error) => {
      statusUpdates.push({ sessionId, status, ...(error ? { error } : {}) });
    },
    notifyStallDetector: (sessionId) => {
      stallNotifications.push(sessionId);
    },
    emitted,
    updatedSessions,
    statusUpdates,
    stallNotifications,
  };
}

// ── Tests ──

describe("Sandbox Event Bridge Translation", () => {
  const sessionId = "session-rate-limiter-a1b2";

  // ─── UB-1: tool_call event translates to agent_token StreamEvent ───
  it("translates tool_call event to agent_token with tool name and duration", () => {
    // Given a SandboxAgent tool_call event (ACP envelope)
    const event = toolCallEvent(sessionId, "osabio-search");

    // When the event is translated
    const result = translateSessionEvent(event);

    // Then it produces an agent_token StreamEvent with tool call info
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect(result!.sessionId).toBe(sessionId);
    expect((result as { token: string }).token).toContain("osabio-search");
  });

  // ─── UB-2: file_edit event — SDK doesn't have a separate file_edit update type.
  // File changes come as tool_call events (e.g. Write tool). Testing that a
  // tool_call with a file-related tool name translates correctly.
  it("translates file-related tool_call to agent_token", () => {
    // Given a SandboxAgent tool_call for a file write
    const event = toolCallEvent(sessionId, "Write");

    // When the event is translated
    const result = translateSessionEvent(event);

    // Then it produces an agent_token StreamEvent
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect((result as { token: string }).token).toContain("Write");
  });

  // ─── UB-3: text/message event translates to agent_token StreamEvent ───
  it("translates text event to agent_token with message content", () => {
    // Given a SandboxAgent agent_message_chunk event
    const event = textChunkEvent(sessionId, "I will implement the sliding window algorithm.");

    // When the event is translated
    const result = translateSessionEvent(event);

    // Then it produces an agent_token StreamEvent with the text
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect((result as { token: string }).token).toBe("I will implement the sliding window algorithm.");
  });

  it("translates message event to agent_token (alias for text)", () => {
    // Given a SandboxAgent user_message_chunk event
    const event = makeSessionEvent(sessionId, {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Starting implementation..." },
        },
      },
    });

    // When the event is translated
    const result = translateSessionEvent(event);

    // Then it produces an agent_token StreamEvent
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect((result as { token: string }).token).toBe("Starting implementation...");
  });

  // ─── UB-4: result event translates to agent_status StreamEvent ───
  it("translates result event to agent_status with idle status", () => {
    // Given a SandboxAgent prompt result (ACP response envelope)
    const event = resultEvent(sessionId);

    // When the event is translated
    const result = translateSessionEvent(event);

    // Then it produces an agent_status StreamEvent
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_status");
    expect((result as { status: string }).status).toBe("idle");
  });

  // ─── UB-5: Unknown event type is logged and skipped (no crash) ───
  it("returns undefined for unknown event types without throwing", () => {
    // Given a SandboxAgent event with an unrecognized session update type
    const event = unknownUpdateEvent(sessionId);

    // When the event is translated
    const result = translateSessionEvent(event);

    // Then translation returns undefined (skipped, not crashed)
    expect(result).toBeUndefined();
  });

  // ─── UB-6: Multiple events translated in sequence preserve order ───
  it("translates multiple events in sequence preserving order", () => {
    // Given a sequence of SandboxAgent events
    const events = [
      textChunkEvent(sessionId, "Starting work..."),
      toolCallEvent(sessionId, "read-file"),
      toolCallEvent(sessionId, "Write"),
    ];

    // When all events are translated
    const results = events
      .map((e) => translateSessionEvent(e))
      .filter((r): r is StreamEvent => r !== undefined);

    // Then all are translated and order is preserved
    expect(results.length).toBe(3);
    expect(results[0].type).toBe("agent_token");
    expect(results[1].type).toBe("agent_token");
    expect(results[2].type).toBe("agent_token");
  });

  // ─── UB-7: Event bridge notifies stall detector on each event ───
  it("notifies stall detector for each processed event", () => {
    // Given an event bridge with stall detector dependency
    const deps = stubBridgeDeps();
    const streamId = "stream-abc";
    const bridge = createSandboxEventBridge(deps, streamId, sessionId);

    // When events are processed through the bridge
    const events = [
      textChunkEvent(sessionId, "Working..."),
      toolCallEvent(sessionId, "read-file"),
    ];

    for (const event of events) {
      bridge.handleEvent(event);
    }

    // Then the stall detector is notified for each event
    expect(deps.stallNotifications.length).toBe(2);
    expect(deps.stallNotifications[0]).toBe(sessionId);
    expect(deps.stallNotifications[1]).toBe(sessionId);

    // And events are emitted to the stream
    expect(deps.emitted.length).toBe(2);
    expect(deps.emitted[0].streamId).toBe(streamId);
  });

  it("persists orchestrator status when bridge emits status events", () => {
    const deps = stubBridgeDeps();
    const streamId = "stream-status";
    const bridge = createSandboxEventBridge(deps, streamId, sessionId);

    bridge.handleEvent(resultEvent(sessionId));

    expect(deps.statusUpdates.length).toBe(1);
    expect(deps.statusUpdates[0]).toEqual({ sessionId, status: "idle" });
  });
});
