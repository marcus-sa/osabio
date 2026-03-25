/**
 * Unit tests for SandboxAgent event bridge translation.
 *
 * Pure transform functions tested with concrete input/output pairs.
 * No real SDK, no SurrealDB, no SSE registry -- stubs for all effects.
 *
 * Traces: US-03 (event bridge)
 *
 * Driving port: Event bridge translation functions (pure)
 */
import { describe, expect, it } from "bun:test";
import {
  translateSandboxEvent,
  createSandboxEventBridge,
  type SandboxEvent,
  type SandboxEventBridgeDeps,
} from "../../../app/src/server/orchestrator/sandbox-event-bridge";
import type { StreamEvent } from "../../../app/src/shared/contracts";

// ── Stub event bridge deps ──

function stubBridgeDeps(): SandboxEventBridgeDeps & {
  emitted: Array<{ streamId: string; event: StreamEvent }>;
  updatedSessions: string[];
  stallNotifications: string[];
} {
  const emitted: Array<{ streamId: string; event: StreamEvent }> = [];
  const updatedSessions: string[] = [];
  const stallNotifications: string[] = [];
  return {
    emitEvent: (streamId, event) => {
      emitted.push({ streamId, event });
    },
    updateLastEventAt: async (sessionId) => {
      updatedSessions.push(sessionId);
    },
    notifyStallDetector: (sessionId) => {
      stallNotifications.push(sessionId);
    },
    emitted,
    updatedSessions,
    stallNotifications,
  };
}

// ── Tests ──

describe("Sandbox Event Bridge Translation", () => {
  const sessionId = "session-rate-limiter-a1b2";

  // ─── UB-1: tool_call event translates to agent_token StreamEvent ───
  it("translates tool_call event to agent_token with tool name and duration", () => {
    // Given a SandboxAgent tool_call event
    const event: SandboxEvent = {
      type: "tool_call",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        toolName: "brain-search",
        arguments: { query: "rate limiting middleware" },
        result: "Found 3 results",
        durationMs: 340,
      },
    };

    // When the event is translated
    const result = translateSandboxEvent(event);

    // Then it produces an agent_token StreamEvent with tool call info
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect(result!.sessionId).toBe(sessionId);
    expect((result as { token: string }).token).toContain("brain-search");
    expect((result as { token: string }).token).toContain("340ms");
  });

  // ─── UB-2: file_edit event translates to agent_file_change StreamEvent ───
  it("translates file_edit event to agent_file_change with path and change type", () => {
    // Given a SandboxAgent file_edit event
    const event: SandboxEvent = {
      type: "file_edit",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        filePath: "src/rate-limiter.ts",
        changeType: "created",
        lineCount: 45,
      },
    };

    // When the event is translated
    const result = translateSandboxEvent(event);

    // Then it produces an agent_file_change StreamEvent
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_file_change");
    expect((result as { file: string }).file).toBe("src/rate-limiter.ts");
    expect((result as { changeType: string }).changeType).toBe("created");
  });

  // ─── UB-3: text/message event translates to agent_token StreamEvent ───
  it("translates text event to agent_token with message content", () => {
    // Given a SandboxAgent text event
    const event: SandboxEvent = {
      type: "text",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: { text: "I will implement the sliding window algorithm." },
    };

    // When the event is translated
    const result = translateSandboxEvent(event);

    // Then it produces an agent_token StreamEvent with the text
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect((result as { token: string }).token).toBe("I will implement the sliding window algorithm.");
  });

  it("translates message event to agent_token (alias for text)", () => {
    // Given a SandboxAgent message event
    const event: SandboxEvent = {
      type: "message",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: { text: "Starting implementation..." },
    };

    // When the event is translated
    const result = translateSandboxEvent(event);

    // Then it produces an agent_token StreamEvent
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_token");
    expect((result as { token: string }).token).toBe("Starting implementation...");
  });

  // ─── UB-4: result event translates to agent_status StreamEvent ───
  it("translates result event to agent_status with completion status", () => {
    // Given a SandboxAgent result event
    const event: SandboxEvent = {
      type: "result",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: { status: "completed", summary: "Rate limiter implemented" },
    };

    // When the event is translated
    const result = translateSandboxEvent(event);

    // Then it produces an agent_status StreamEvent
    expect(result).toBeDefined();
    expect(result!.type).toBe("agent_status");
    expect((result as { status: string }).status).toBe("completed");
  });

  // ─── UB-5: Unknown event type is logged and skipped (no crash) ───
  it("returns undefined for unknown event types without throwing", () => {
    // Given a SandboxAgent event with an unrecognized type
    const event: SandboxEvent = {
      type: "agent_thinking",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: { thought: "Considering approaches..." },
    };

    // When the event is translated
    const result = translateSandboxEvent(event);

    // Then translation returns undefined (skipped, not crashed)
    expect(result).toBeUndefined();
  });

  // ─── UB-6: Multiple events translated in sequence preserve order ───
  it("translates multiple events in sequence preserving order", () => {
    // Given a sequence of SandboxAgent events
    const events: SandboxEvent[] = [
      {
        type: "text",
        sessionId,
        timestamp: "2026-03-25T10:00:00Z",
        payload: { text: "Starting work..." },
      },
      {
        type: "tool_call",
        sessionId,
        timestamp: "2026-03-25T10:00:01Z",
        payload: { toolName: "read-file", durationMs: 50 },
      },
      {
        type: "file_edit",
        sessionId,
        timestamp: "2026-03-25T10:00:02Z",
        payload: { filePath: "src/index.ts", changeType: "modified" },
      },
    ];

    // When all events are translated
    const results = events
      .map((e) => translateSandboxEvent(e))
      .filter((r): r is StreamEvent => r !== undefined);

    // Then all are translated and order is preserved
    expect(results.length).toBe(3);
    expect(results[0].type).toBe("agent_token");
    expect(results[1].type).toBe("agent_token");
    expect(results[2].type).toBe("agent_file_change");
  });

  // ─── UB-7: Event bridge notifies stall detector on each event ───
  it("notifies stall detector for each processed event", () => {
    // Given an event bridge with stall detector dependency
    const deps = stubBridgeDeps();
    const streamId = "stream-abc";
    const bridge = createSandboxEventBridge(deps, streamId, sessionId);

    // When events are processed through the bridge
    const events: SandboxEvent[] = [
      {
        type: "text",
        sessionId,
        timestamp: "2026-03-25T10:00:00Z",
        payload: { text: "Working..." },
      },
      {
        type: "tool_call",
        sessionId,
        timestamp: "2026-03-25T10:00:01Z",
        payload: { toolName: "read-file", durationMs: 50 },
      },
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
});
