/**
 * Unit tests for event-bridge: SDK Message -> Brain StreamEvent transforms.
 *
 * Pure transform functions tested directly. Bridge handle tested with
 * function stubs for emitEvent and updateLastEventAt.
 */
import { describe, expect, it } from "bun:test";
import {
  transformSdkMessage,
  startEventBridge,
  type SdkMessage,
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
// Pure transform: transformSdkMessage
// ---------------------------------------------------------------------------

describe("transformSdkMessage", () => {
  const sessionId = "sess-abc";

  it("transforms assistant message with text content to AgentTokenEvent", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [{ type: "text", text: "hello world" }],
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_token",
        sessionId,
        token: "hello world",
      },
    ]);
  });

  it("transforms assistant message with multiple text blocks to multiple AgentTokenEvents", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      { type: "agent_token", sessionId, token: "first" },
      { type: "agent_token", sessionId, token: "second" },
    ]);
  });

  it("transforms assistant message with tool_use Write to AgentFileChangeEvent", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "Write",
          input: { file_path: "src/index.ts", content: "console.log('hi')" },
        },
      ],
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_file_change",
        sessionId,
        file: "src/index.ts",
        changeType: "created",
      },
    ]);
  });

  it("transforms assistant message with tool_use Edit to AgentFileChangeEvent", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-2",
          name: "Edit",
          input: { file_path: "src/main.ts", old_string: "foo", new_string: "bar" },
        },
      ],
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_file_change",
        sessionId,
        file: "src/main.ts",
        changeType: "modified",
      },
    ]);
  });

  it("transforms result success to AgentStatusEvent completed", () => {
    const message: SdkMessage = {
      type: "result",
      subtype: "success",
      duration_ms: 5000,
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_status",
        sessionId,
        status: "completed",
      },
    ]);
  });

  it("transforms result error to AgentStatusEvent with error", () => {
    const message: SdkMessage = {
      type: "result",
      subtype: "error",
      error: "Out of memory",
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_status",
        sessionId,
        status: "error",
        error: "Out of memory",
      },
    ]);
  });

  it("returns empty array for tool_use without file operation", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-3",
          name: "Grep",
          input: { pattern: "foo" },
        },
      ],
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([]);
  });

  it("transforms mixed content blocks to appropriate events", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [
        { type: "text", text: "Let me edit that file." },
        {
          type: "tool_use",
          id: "tool-4",
          name: "Write",
          input: { file_path: "package.json", content: "{}" },
        },
      ],
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      { type: "agent_token", sessionId, token: "Let me edit that file." },
      { type: "agent_file_change", sessionId, file: "package.json", changeType: "created" },
    ]);
  });

  it("transforms Bash tool_use to AgentFileChangeEvent when file path detectable", () => {
    const message: SdkMessage = {
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-5",
          name: "Bash",
          input: { command: "echo hello > output.txt" },
        },
      ],
    };

    // Bash commands without clear file_path are not file changes
    const result = transformSdkMessage(message, sessionId);
    expect(result).toEqual([]);
  });

  it("suppresses system init messages", () => {
    const message: SdkMessage = {
      type: "system",
      subtype: "init",
      claude_code_version: "2.1.71",
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([]);
  });

  it("suppresses system task_started messages", () => {
    const message: SdkMessage = {
      type: "system",
      subtype: "task_started",
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([]);
  });

  it("suppresses system task_progress messages", () => {
    const message: SdkMessage = {
      type: "system",
      subtype: "task_progress",
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([]);
  });

  it("surfaces mcp_server_error system messages", () => {
    const message: SdkMessage = {
      type: "system",
      subtype: "mcp_server_error",
      server_name: "osabio",
      error: "connection refused",
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_token",
        sessionId,
        token: '[system] MCP server "osabio" failed: connection refused\n',
      },
    ]);
  });

  it("surfaces unknown system subtypes as informational tokens", () => {
    const message: SdkMessage = {
      type: "system",
      subtype: "custom_event",
    };

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_token",
        sessionId,
        token: "[system] custom_event\n",
      },
    ]);
  });

  it("returns empty array for unknown message types", () => {
    const message = { type: "user" } as SdkMessage;

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([]);
  });

  it("returns empty array for assistant messages without content", () => {
    const message = {
      type: "assistant",
    } as SdkMessage;

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([]);
  });

  it("reads assistant content from nested message.content payloads", () => {
    const message = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "from nested payload" }],
      },
    } as SdkMessage;

    const result = transformSdkMessage(message, sessionId);

    expect(result).toEqual([
      {
        type: "agent_token",
        sessionId,
        token: "from nested payload",
      },
    ]);
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

    bridge.handleMessage({
      type: "assistant",
      content: [{ type: "text", text: "token-1" }],
    });

    expect(deps.emitted).toHaveLength(1);
    expect(deps.emitted[0].streamId).toBe(streamId);
    expect(deps.emitted[0].event).toEqual({
      type: "agent_token",
      sessionId,
      token: "token-1",
    });
  });

  it("calls updateLastEventAt for each message", async () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleMessage({
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    });

    // Allow microtask to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.updatedSessions).toContain(sessionId);
  });

  it("does not emit events after stop is called", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.stop();

    bridge.handleMessage({
      type: "assistant",
      content: [{ type: "text", text: "should-not-appear" }],
    });

    expect(deps.emitted).toHaveLength(0);
  });

  it("forwards result errors with diagnostic information", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleMessage({
      type: "result",
      subtype: "error",
      error: "Process crashed: segfault",
    });

    expect(deps.emitted).toHaveLength(1);
    const event = deps.emitted[0].event as { type: string; error?: string };
    expect(event.type).toBe("agent_status");
    expect(event.error).toBe("Process crashed: segfault");
  });

  it("handles multiple messages in sequence", () => {
    const deps = stubDeps();
    const bridge = startEventBridge(deps, streamId, sessionId);

    bridge.handleMessage({
      type: "assistant",
      content: [{ type: "text", text: "first" }],
    });
    bridge.handleMessage({
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "Write",
          input: { file_path: "package.json", content: "{}" },
        },
      ],
    });
    bridge.handleMessage({
      type: "result",
      subtype: "success",
      duration_ms: 1000,
    });

    expect(deps.emitted).toHaveLength(3);
    expect((deps.emitted[0].event as { type: string }).type).toBe("agent_token");
    expect((deps.emitted[1].event as { type: string }).type).toBe("agent_file_change");
    expect((deps.emitted[2].event as { type: string }).type).toBe("agent_status");
  });

  it("increments stall detector step count for file operation tool_use", () => {
    const deps = stubDeps();
    let stepCount = 0;
    const stallDetector = {
      recordActivity: () => {},
      incrementStepCount: () => { stepCount++; },
      stop: () => {},
    };
    const bridge = startEventBridge(deps, streamId, sessionId, stallDetector);

    bridge.handleMessage({
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "Write",
          input: { file_path: "src/index.ts", content: "" },
        },
      ],
    });

    expect(stepCount).toBe(1);
  });
});
