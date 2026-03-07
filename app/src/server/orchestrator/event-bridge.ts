/**
 * Event bridge: transforms Claude Agent SDK messages into Brain StreamEvent
 * variants and forwards them to the SSE registry.
 *
 * Pure transform function (transformSdkMessage) + effectful bridge handle
 * (startEventBridge) that manages the event forwarding lifecycle.
 */
import type {
  AgentTokenEvent,
  AgentFileChangeEvent,
  AgentStatusEvent,
  StreamEvent,
} from "../../shared/contracts";
import { logWarn } from "../http/observability";
import type { StallDetectorHandle } from "./stall-detector";

// ---------------------------------------------------------------------------
// SDK message types (from @anthropic-ai/claude-code)
// ---------------------------------------------------------------------------

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type SdkMessage =
  | { type: "assistant"; content: ContentBlock[] }
  | { type: "result"; subtype: "success"; duration_ms: number }
  | { type: "result"; subtype: "error"; error: string }
  | { type: "system"; subtype: string; [key: string]: unknown }
  | { type: "user" };

// ---------------------------------------------------------------------------
// Port: dependencies as function signatures
// ---------------------------------------------------------------------------

export type EventBridgeDeps = {
  emitEvent: (streamId: string, event: StreamEvent) => void;
  updateLastEventAt: (sessionId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Bridge handle
// ---------------------------------------------------------------------------

export type EventBridgeHandle = {
  handleMessage: (message: SdkMessage) => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// File operation tool detection
// ---------------------------------------------------------------------------

/** Tool names that represent file write/edit operations. */
const FILE_WRITE_TOOLS = new Set(["Write"]);
const FILE_EDIT_TOOLS = new Set(["Edit"]);

function isFileOperationTool(toolName: string): boolean {
  return FILE_WRITE_TOOLS.has(toolName) || FILE_EDIT_TOOLS.has(toolName);
}

function extractFileChangeType(toolName: string): AgentFileChangeEvent["changeType"] {
  if (FILE_WRITE_TOOLS.has(toolName)) return "created";
  if (FILE_EDIT_TOOLS.has(toolName)) return "modified";
  return "modified";
}

function extractFilePath(input: Record<string, unknown>): string | undefined {
  if (typeof input.file_path === "string") return input.file_path;
  return undefined;
}

// ---------------------------------------------------------------------------
// Pure transform: SDK message -> Brain StreamEvent[]
// ---------------------------------------------------------------------------

function transformTextBlock(
  block: { type: "text"; text: string },
  sessionId: string,
): AgentTokenEvent {
  return {
    type: "agent_token",
    sessionId,
    token: block.text,
  };
}

function transformToolUseBlock(
  block: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> },
  sessionId: string,
): AgentFileChangeEvent | undefined {
  if (!isFileOperationTool(block.name)) return undefined;

  const filePath = extractFilePath(block.input);
  if (!filePath) return undefined;

  return {
    type: "agent_file_change",
    sessionId,
    file: filePath,
    changeType: extractFileChangeType(block.name),
  };
}

function transformAssistantContent(
  content: ContentBlock[],
  sessionId: string,
): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of content) {
    if (block.type === "text") {
      events.push(transformTextBlock(block, sessionId));
    } else if (block.type === "tool_use") {
      const fileEvent = transformToolUseBlock(block, sessionId);
      if (fileEvent) events.push(fileEvent);
    }
  }
  return events;
}

function transformResultMessage(
  message: { type: "result"; subtype: "success"; duration_ms: number } | { type: "result"; subtype: "error"; error: string },
  sessionId: string,
): AgentStatusEvent {
  if (message.subtype === "error") {
    return {
      type: "agent_status",
      sessionId,
      status: "error",
      error: message.error,
    };
  }
  return {
    type: "agent_status",
    sessionId,
    status: "completed",
  };
}

function transformSystemMessage(
  message: { type: "system"; subtype: string; [key: string]: unknown },
  sessionId: string,
): AgentTokenEvent | undefined {
  const subtype = message.subtype;

  if (subtype === "init") {
    const version = message.claude_code_version ?? "unknown";
    return { type: "agent_token", sessionId, token: `[system] Claude Code ${version} initialized\n` };
  }

  if (subtype === "mcp_server_error") {
    const server = (message as Record<string, unknown>).server_name ?? "unknown";
    const error = (message as Record<string, unknown>).error ?? "";
    return { type: "agent_token", sessionId, token: `[system] MCP server "${server}" failed: ${error}\n` };
  }

  // Surface other system subtypes as informational tokens
  return { type: "agent_token", sessionId, token: `[system] ${subtype}\n` };
}

export function transformSdkMessage(
  message: SdkMessage,
  sessionId: string,
): StreamEvent[] {
  switch (message.type) {
    case "assistant":
      return transformAssistantContent(message.content, sessionId);

    case "result":
      return [transformResultMessage(message, sessionId)];

    case "system": {
      const event = transformSystemMessage(message, sessionId);
      return event ? [event] : [];
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Step event detection for stall detector
// ---------------------------------------------------------------------------

/** Returns true if the message contains tool_use blocks for file operations. */
function containsFileOperationStep(message: SdkMessage): boolean {
  if (message.type !== "assistant") return false;
  return message.content.some(
    (block) => block.type === "tool_use" && isFileOperationTool(block.name),
  );
}

// ---------------------------------------------------------------------------
// Bridge handle factory
// ---------------------------------------------------------------------------

export function startEventBridge(
  deps: EventBridgeDeps,
  streamId: string,
  sessionId: string,
  stallDetector?: StallDetectorHandle,
): EventBridgeHandle {
  let stopped = false;

  const handleMessage = (message: SdkMessage): void => {
    if (stopped) return;

    const streamEvents = transformSdkMessage(message, sessionId);
    for (const streamEvent of streamEvents) {
      deps.emitEvent(streamId, streamEvent);
    }

    // Fire-and-forget: update last_event_at for stall detection
    if (streamEvents.length > 0) {
      deps.updateLastEventAt(sessionId).catch((err) => {
        logWarn("event-bridge", "Failed to update last_event_at", { sessionId, error: String(err) });
      });
    }

    // Notify stall detector of activity
    if (stallDetector && streamEvents.length > 0) {
      stallDetector.recordActivity();

      if (containsFileOperationStep(message)) {
        stallDetector.incrementStepCount();
      }
    }
  };

  return {
    handleMessage,
    stop(): void {
      stopped = true;
      stallDetector?.stop();
    },
  };
}
