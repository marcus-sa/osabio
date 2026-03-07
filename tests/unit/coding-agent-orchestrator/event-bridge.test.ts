/**
 * Unit tests for event-bridge: OpenCode event -> Brain StreamEvent transforms.
 *
 * Pure transform functions tested directly. Bridge handle tested with
 * function stubs for emitEvent and updateLastEventAt.
 */
import { describe, expect, it } from "bun:test";
import {
  transformOpencodeEvent,
  startEventBridge,
  type OpencodeEvent,
  type EventBridgeDeps,
} from "../../../app/src/server/orchestrator/event-bridge";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function stubDeps(overrides: Partial<EventBridgeDeps> = {}): EventBridgeDeps & {
  emitted: Array<{ streamId: string; event: unknown }>;
  updatedSessions: string[];
} {
  const emitted: Array<{ streamId: string; event: unknown }> = [];
  const updatedSessions: string[] = [];
  return {
    emitEvent: (streamId, event) => {
      emitted.push({ streamId, event });
    },
    updateLastEventAt: async (sessionId) => {
      updatedSessions.push(sessionId);
    },
    emitted,
    updatedSessions,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure transform: transformOpencodeEvent
// ---------------------------------------------------------------------------

describe("transformOpencodeEvent", () => {
  const sessionId = "sess-abc";

  it("transforms message.part.updated with text to AgentTokenEvent", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "message.part.updated",
      sessionId,
      part: { type: "text", content: "hello world" },
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_token",
      sessionId,
      token: "hello world",
    });
  });

  it("transforms file.edited to AgentFileChangeEvent", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "file.edited",
      sessionId,
      file: "src/index.ts",
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_file_change",
      sessionId,
      file: "src/index.ts",
      changeType: "modified",
    });
  });

  it("transforms session.updated to AgentStatusEvent", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "session.updated",
      sessionId,
      status: "busy",
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_status",
      sessionId,
      status: "active",
    });
  });

  it("maps session.updated idle status to idle", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "session.updated",
      sessionId,
      status: "idle",
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_status",
      sessionId,
      status: "idle",
    });
  });

  it("maps session.updated completed status to completed", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "session.updated",
      sessionId,
      status: "completed",
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_status",
      sessionId,
      status: "completed",
    });
  });

  it("maps unknown session status to active", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "session.updated",
      sessionId,
      status: "some_unknown_status",
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_status",
      sessionId,
      status: "active",
    });
  });

  it("transforms session.error to AgentStatusEvent with error", () => {
    const opencodeEvent: OpencodeEvent = {
      type: "session.error",
      sessionId,
      error: "Out of memory",
    };

    const result = transformOpencodeEvent(opencodeEvent);

    expect(result).toEqual({
      type: "agent_status",
      sessionId,
      status: "error",
      error: "Out of memory",
    });
  });
});

// ---------------------------------------------------------------------------
// Bridge handle: startEventBridge
// ---------------------------------------------------------------------------

describe("startEventBridge", () => {
  const streamId = "stream-sess-abc";
  const sessionId = "sess-abc";

  it("forwards transformed events to emitEvent with correct streamId", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleEvent({
      type: "message.part.updated",
      sessionId,
      part: { type: "text", content: "token-1" },
    });

    expect(deps.emitted).toHaveLength(1);
    expect(deps.emitted[0].streamId).toBe(streamId);
    expect(deps.emitted[0].event).toEqual({
      type: "agent_token",
      sessionId,
      token: "token-1",
    });
  });

  it("calls updateLastEventAt for each event", async () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleEvent({
      type: "file.edited",
      sessionId,
      file: "src/main.ts",
    });

    // Allow microtask to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.updatedSessions).toContain(sessionId);
  });

  it("does not emit events after stop is called", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.stop();

    bridge.handleEvent({
      type: "message.part.updated",
      sessionId,
      part: { type: "text", content: "should-not-appear" },
    });

    expect(deps.emitted).toHaveLength(0);
  });

  it("forwards session errors with diagnostic information", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleEvent({
      type: "session.error",
      sessionId,
      error: "Process crashed: segfault",
    });

    expect(deps.emitted).toHaveLength(1);
    const event = deps.emitted[0].event as { type: string; error?: string };
    expect(event.type).toBe("agent_status");
    expect(event.error).toBe("Process crashed: segfault");
  });

  it("handles multiple events in sequence", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleEvent({
      type: "message.part.updated",
      sessionId,
      part: { type: "text", content: "first" },
    });
    bridge.handleEvent({
      type: "file.edited",
      sessionId,
      file: "package.json",
    });
    bridge.handleEvent({
      type: "session.updated",
      sessionId,
      status: "completed",
    });

    expect(deps.emitted).toHaveLength(3);
    expect((deps.emitted[0].event as { type: string }).type).toBe("agent_token");
    expect((deps.emitted[1].event as { type: string }).type).toBe("agent_file_change");
    expect((deps.emitted[2].event as { type: string }).type).toBe("agent_status");
  });
});
