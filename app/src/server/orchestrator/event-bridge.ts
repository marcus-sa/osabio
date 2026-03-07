/**
 * Event bridge: transforms OpenCode SSE events into Brain StreamEvent variants
 * and forwards them to the SSE registry.
 *
 * Pure transform function (transformOpencodeEvent) + effectful bridge handle
 * (startEventBridge) that manages the event forwarding lifecycle.
 */
import type {
  AgentTokenEvent,
  AgentFileChangeEvent,
  AgentStatusEvent,
  StreamEvent,
} from "../../shared/contracts";

// ---------------------------------------------------------------------------
// OpenCode event types (from @opencode-ai/sdk)
// ---------------------------------------------------------------------------

export type OpencodeEvent =
  | { type: "message.part.updated"; sessionId: string; part: { type: "text"; content: string } }
  | { type: "file.edited"; sessionId: string; file: string }
  | { type: "session.updated"; sessionId: string; status: string }
  | { type: "session.error"; sessionId: string; error: string };

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
  handleEvent: (event: OpencodeEvent) => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// Pure transform: OpenCode event -> Brain StreamEvent
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, AgentStatusEvent["status"]> = {
  busy: "active",
  running: "active",
  idle: "idle",
  completed: "completed",
  done: "completed",
  error: "error",
  failed: "error",
  aborted: "aborted",
  cancelled: "aborted",
};

function mapOpencodeStatus(opencodeStatus: string): AgentStatusEvent["status"] {
  return STATUS_MAP[opencodeStatus] ?? "active";
}

export function transformOpencodeEvent(
  event: OpencodeEvent,
): AgentTokenEvent | AgentFileChangeEvent | AgentStatusEvent {
  switch (event.type) {
    case "message.part.updated":
      return {
        type: "agent_token",
        sessionId: event.sessionId,
        token: event.part.content,
      };

    case "file.edited":
      return {
        type: "agent_file_change",
        sessionId: event.sessionId,
        file: event.file,
        changeType: "modified",
      };

    case "session.updated":
      return {
        type: "agent_status",
        sessionId: event.sessionId,
        status: mapOpencodeStatus(event.status),
      };

    case "session.error":
      return {
        type: "agent_status",
        sessionId: event.sessionId,
        status: "error",
        error: event.error,
      };
  }
}

// ---------------------------------------------------------------------------
// Bridge handle factory
// ---------------------------------------------------------------------------

export function startEventBridge(
  deps: EventBridgeDeps,
  streamId: string,
  sessionId: string,
): EventBridgeHandle {
  let stopped = false;

  return {
    handleEvent(event: OpencodeEvent): void {
      if (stopped) return;

      const streamEvent = transformOpencodeEvent(event);
      deps.emitEvent(streamId, streamEvent);

      // Fire-and-forget: update last_event_at for stall detection
      deps.updateLastEventAt(sessionId);
    },

    stop(): void {
      stopped = true;
    },
  };
}
