/**
 * Sandbox event bridge: transforms SandboxAgent events into Brain StreamEvent
 * variants and forwards them to the SSE registry.
 *
 * Pure transform function (translateSandboxEvent) + effectful bridge handle
 * (createSandboxEventBridge) that manages the event forwarding lifecycle.
 *
 * This module handles SandboxAgent events (different schema from event-bridge.ts
 * which handles Claude SDK messages). Both coexist until R1 migration completes.
 */
import type {
  AgentTokenEvent,
  AgentFileChangeEvent,
  AgentStatusEvent,
  StreamEvent,
} from "../../shared/contracts";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// SandboxAgent event type
// ---------------------------------------------------------------------------

export type SandboxEvent = {
  type: string;
  sessionId: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Port: dependencies as function signatures
// ---------------------------------------------------------------------------

export type SandboxEventBridgeDeps = {
  emitEvent: (streamId: string, event: StreamEvent) => void;
  updateLastEventAt: (sessionId: string) => Promise<void>;
  notifyStallDetector: (sessionId: string) => void;
};

// ---------------------------------------------------------------------------
// Bridge handle
// ---------------------------------------------------------------------------

export type SandboxEventBridgeHandle = {
  handleEvent: (event: SandboxEvent) => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// Pure transform: SandboxEvent -> StreamEvent | undefined
// ---------------------------------------------------------------------------

function translateToolCall(event: SandboxEvent): AgentTokenEvent {
  const toolName = event.payload.toolName as string ?? "unknown";
  const durationMs = event.payload.durationMs as number ?? 0;
  return {
    type: "agent_token",
    sessionId: event.sessionId,
    token: `Tool Call: ${toolName} (${durationMs}ms)`,
  };
}

function translateFileEdit(event: SandboxEvent): AgentFileChangeEvent {
  return {
    type: "agent_file_change",
    sessionId: event.sessionId,
    file: event.payload.filePath as string,
    changeType: event.payload.changeType as AgentFileChangeEvent["changeType"],
  };
}

function translateTextOrMessage(event: SandboxEvent): AgentTokenEvent {
  return {
    type: "agent_token",
    sessionId: event.sessionId,
    token: event.payload.text as string,
  };
}

function translateResult(event: SandboxEvent): AgentStatusEvent {
  return {
    type: "agent_status",
    sessionId: event.sessionId,
    status: (event.payload.status as AgentStatusEvent["status"]) ?? "completed",
  };
}

export function translateSandboxEvent(
  event: SandboxEvent,
): StreamEvent | undefined {
  switch (event.type) {
    case "tool_call":
      return translateToolCall(event);

    case "file_edit":
      return translateFileEdit(event);

    case "text":
    case "message":
      return translateTextOrMessage(event);

    case "result":
      return translateResult(event);

    default:
      log.warn("sandbox-event-bridge", "Unknown sandbox event type, skipping", {
        eventType: event.type,
        sessionId: event.sessionId,
      });
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Bridge handle factory
// ---------------------------------------------------------------------------

export function createSandboxEventBridge(
  deps: SandboxEventBridgeDeps,
  streamId: string,
  sessionId: string,
): SandboxEventBridgeHandle {
  let stopped = false;

  const handleEvent = (event: SandboxEvent): void => {
    if (stopped) return;

    const streamEvent = translateSandboxEvent(event);
    if (!streamEvent) return;

    deps.emitEvent(streamId, streamEvent);

    // Fire-and-forget: update last_event_at for stall detection
    deps.updateLastEventAt(sessionId).catch((err) => {
      log.warn("sandbox-event-bridge", "Failed to update last_event_at", {
        sessionId,
        error: String(err),
      });
    });

    // Notify stall detector of activity
    deps.notifyStallDetector(sessionId);
  };

  return {
    handleEvent,
    stop(): void {
      stopped = true;
    },
  };
}
