/**
 * Sandbox event bridge: transforms SandboxAgent SessionEvents into Brain
 * StreamEvent variants and forwards them to the SSE registry.
 *
 * Pure transform function (translateSessionEvent) + effectful bridge handle
 * (createSandboxEventBridge) that manages the event forwarding lifecycle.
 *
 * SessionEvent.payload is an ACP JSON-RPC message. The bridge extracts
 * session/update notifications and maps their content to Brain stream events.
 *
 * This module handles SandboxAgent events (different schema from event-bridge.ts
 * which handles Claude SDK messages). Both coexist until R1 migration completes.
 */
import type {
  AgentTokenEvent,
  AgentStatusEvent,
  StreamEvent,
} from "../../shared/contracts";
import type { SessionEvent } from "./sandbox-adapter";
import { log } from "../telemetry/logger";

// Re-export for callers that reference the old SandboxEvent name
export type SandboxEvent = SessionEvent;

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
  handleEvent: (event: SessionEvent) => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// ACP JSON-RPC payload helpers (untyped extraction from AnyMessage)
// ---------------------------------------------------------------------------

type AcpPayload = {
  method?: string;
  params?: {
    sessionId?: string;
    update?: {
      sessionUpdate?: string;
      content?: { type?: string; text?: string };
      toolCallId?: string;
      name?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

function extractSessionUpdate(payload: AcpPayload): { sessionUpdate: string; [key: string]: unknown } | undefined {
  if (payload.method === "session/update" && payload.params?.update) {
    return payload.params.update as { sessionUpdate: string; [key: string]: unknown };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pure transform: SessionEvent -> StreamEvent | undefined
// ---------------------------------------------------------------------------

function translateToolCall(
  sessionId: string,
  update: { name?: string; toolCallId?: string; [key: string]: unknown },
): AgentTokenEvent {
  const toolName = (update.name as string) ?? "unknown";
  return {
    type: "agent_token",
    sessionId,
    token: `Tool Call: ${toolName}`,
  };
}

function translateMessageChunk(
  sessionId: string,
  update: { content?: { text?: string }; [key: string]: unknown },
): AgentTokenEvent | undefined {
  const text = update.content?.text;
  if (!text) return undefined;
  return {
    type: "agent_token",
    sessionId,
    token: text,
  };
}

export function translateSessionEvent(
  event: SessionEvent,
): StreamEvent | undefined {
  const payload = event.payload as AcpPayload;
  const update = extractSessionUpdate(payload);

  if (!update) {
    // Not a session/update notification -- may be a response or other message.
    // Check if it's a prompt response (which has result.stopReason)
    if (payload.result && typeof payload.result === "object") {
      const result = payload.result as { stopReason?: string };
      if (result.stopReason) {
        return {
          type: "agent_status",
          sessionId: event.sessionId,
          status: "completed" as AgentStatusEvent["status"],
        };
      }
    }
    return undefined;
  }

  switch (update.sessionUpdate) {
    case "tool_call":
      return translateToolCall(event.sessionId, update);

    case "agent_message_chunk":
    case "user_message_chunk":
    case "agent_thought_chunk":
      return translateMessageChunk(event.sessionId, update);

    default:
      // Other update types (plan, config_option_update, etc.) are informational
      // and don't map to Brain stream events yet.
      return undefined;
  }
}

// Backwards-compatible alias
export const translateSandboxEvent = translateSessionEvent;

// ---------------------------------------------------------------------------
// Bridge handle factory
// ---------------------------------------------------------------------------

export function createSandboxEventBridge(
  deps: SandboxEventBridgeDeps,
  streamId: string,
  sessionId: string,
): SandboxEventBridgeHandle {
  let stopped = false;

  const handleEvent = (event: SessionEvent): void => {
    if (stopped) return;

    const streamEvent = translateSessionEvent(event);
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
