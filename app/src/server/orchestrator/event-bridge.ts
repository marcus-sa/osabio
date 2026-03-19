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
import type { StallDetectorHandle } from "./stall-detector";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// SDK message types (from @anthropic-ai/claude-code)
// ---------------------------------------------------------------------------

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type SdkMessage =
  | {
      type: "assistant";
      content?: unknown;
      message?: {
        content?: unknown;
      };
    }
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

function toContentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];

  const blocks: ContentBlock[] = [];
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw as {
      type?: unknown;
      text?: unknown;
      id?: unknown;
      name?: unknown;
      input?: unknown;
      tool_use_id?: unknown;
      content?: unknown;
    };

    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }

    if (
      block.type === "tool_use"
      && typeof block.id === "string"
      && typeof block.name === "string"
      && typeof block.input === "object"
      && block.input !== null
    ) {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
      continue;
    }

    if (
      block.type === "tool_result"
      && typeof block.tool_use_id === "string"
      && typeof block.content === "string"
    ) {
      blocks.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
      });
    }
  }

  return blocks;
}

function extractAssistantContent(message: {
  content?: unknown;
  message?: {
    content?: unknown;
  };
}): ContentBlock[] {
  const direct = toContentBlocks(message.content);
  if (direct.length > 0) return direct;
  return toContentBlocks(message.message?.content);
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

/** System subtypes that carry no user-visible information and should be suppressed. */
const SUPPRESSED_SYSTEM_SUBTYPES = new Set([
  "init",
  "task_started",
  "task_progress",
]);

function transformSystemMessage(
  message: { type: "system"; subtype: string; [key: string]: unknown },
  sessionId: string,
): AgentTokenEvent | undefined {
  const subtype = message.subtype;

  if (SUPPRESSED_SYSTEM_SUBTYPES.has(subtype)) return undefined;

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
      return transformAssistantContent(extractAssistantContent(message), sessionId);

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
  const content = extractAssistantContent(message);
  return content.some(
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
        log.warn("event-bridge", "Failed to update last_event_at", { sessionId, error: String(err) });
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
