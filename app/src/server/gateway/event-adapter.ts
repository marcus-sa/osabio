/**
 * Event adapter — pure mapping from Brain StreamEvent to Gateway Protocol EventFrame.
 *
 * No IO, no side effects, no imports from IO modules.
 *
 * Maps 7 agent-facing StreamEvent variants to Gateway EventFrames:
 * - AgentTokenEvent       -> assistant stream (delta)
 * - AgentFileChangeEvent  -> lifecycle stream (file_change)
 * - AgentStatusEvent      -> lifecycle stream (status phase)
 * - AgentStallWarningEvent -> lifecycle stream (stall_warning)
 * - AgentPromptEvent      -> lifecycle stream (prompt)
 * - ErrorEvent            -> error stream
 * - DoneEvent             -> lifecycle stream (done)
 *
 * Drops 7 Brain-internal variants (token, reasoning, assistant_message,
 * extraction, onboarding_seed, onboarding_state, observation).
 */
import type { StreamEvent } from "../../shared/contracts";
import type { EventFrame } from "./protocol";

// ---------------------------------------------------------------------------
// Helper — build an agent.stream event frame
// ---------------------------------------------------------------------------

function agentStreamFrame(
  stream: string,
  data: Record<string, unknown>,
  seq: number,
): EventFrame {
  return {
    type: "event",
    event: "agent.stream",
    payload: { stream, data },
    seq,
  };
}

// ---------------------------------------------------------------------------
// Pure mapping function
// ---------------------------------------------------------------------------

/**
 * Map a Brain StreamEvent to a Gateway Protocol EventFrame.
 *
 * Returns undefined for Brain-internal events that have no gateway equivalent.
 * The caller should skip undefined results (do not send on WebSocket).
 */
export function mapStreamEventToGatewayEvent(
  event: StreamEvent,
  seq: number,
): EventFrame | undefined {
  switch (event.type) {
    case "agent_token":
      return agentStreamFrame("assistant", { delta: event.token }, seq);

    case "agent_file_change":
      return agentStreamFrame(
        "lifecycle",
        {
          phase: "file_change",
          file: event.file,
          changeType: event.changeType,
        },
        seq,
      );

    case "agent_status":
      return agentStreamFrame("lifecycle", { phase: event.status }, seq);

    case "agent_stall_warning":
      return agentStreamFrame(
        "lifecycle",
        {
          phase: "stall_warning",
          lastEventAt: event.lastEventAt,
          stallDurationSeconds: event.stallDurationSeconds,
        },
        seq,
      );

    case "agent_prompt":
      return agentStreamFrame("lifecycle", { phase: "prompt" }, seq);

    case "exec_request":
      return {
        type: "event",
        event: "exec.request",
        payload: { requestId: event.requestId, command: event.command },
        seq,
      };

    case "error":
      return agentStreamFrame("error", { error: event.error }, seq);

    case "done":
      return agentStreamFrame("lifecycle", { phase: "done" }, seq);

    // Brain-internal events — no gateway equivalent
    case "token":
    case "reasoning":
    case "assistant_message":
    case "extraction":
    case "onboarding_seed":
    case "onboarding_state":
    case "observation":
      return undefined;
  }
}
