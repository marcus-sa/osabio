/**
 * useAgentSession -- SSE subscription hook for agent session state.
 *
 * Opens an EventSource when given an active sessionId + streamUrl.
 * Exposes AgentSessionState: status, filesChanged, startedAt,
 * stallWarning, connectionError.
 *
 * Pure core: reduceAgentSessionEvent handles all state transitions.
 * Effect boundary: useEffect manages EventSource lifecycle + stall timer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentStatusEvent,
  AgentFileChangeEvent,
  AgentStallWarningEvent,
  AgentTokenEvent,
  AgentPromptEvent,
} from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentSessionStatus =
  | "spawning"
  | "active"
  | "idle"
  | "completed"
  | "aborted"
  | "error";

export type OutputEntryToken = { kind: "token"; text: string };
export type OutputEntryFileChange = {
  kind: "file_change";
  file: string;
  changeType: "created" | "modified" | "deleted";
};
export type OutputEntryPrompt = { kind: "prompt"; text: string };

export type OutputEntry =
  | OutputEntryToken
  | OutputEntryFileChange
  | OutputEntryPrompt;

export type AgentSessionState = {
  status: AgentSessionStatus;
  filesChanged: number;
  startedAt: string;
  lastEventAt?: string;
  stallWarning?: { lastEventAt: string; stallDurationSeconds: number };
  error?: string;
  connectionError?: string;
  outputEntries: OutputEntry[];
};

// Events the reducer handles (subset of StreamEvent relevant to agent sessions)
type AgentEvent =
  | AgentStatusEvent
  | AgentFileChangeEvent
  | AgentStallWarningEvent
  | AgentTokenEvent
  | AgentPromptEvent;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STALL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Pure core: state reducer
// ---------------------------------------------------------------------------

export function createInitialState(startedAt: string): AgentSessionState {
  return {
    status: "spawning",
    filesChanged: 0,
    startedAt,
    outputEntries: [],
  };
}

export function isTerminalStatus(status: AgentSessionStatus): boolean {
  return status === "completed" || status === "aborted" || status === "error";
}

export function reduceAgentSessionEvent(
  state: AgentSessionState,
  event: AgentEvent,
): AgentSessionState {
  const now = new Date().toISOString();

  switch (event.type) {
    case "agent_status":
      return {
        ...state,
        status: event.status,
        lastEventAt: now,
        stallWarning: undefined,
        error: event.error,
      };

    case "agent_file_change":
      return {
        ...state,
        filesChanged: state.filesChanged + 1,
        lastEventAt: now,
        stallWarning: undefined,
        outputEntries: [
          ...state.outputEntries,
          { kind: "file_change", file: event.file, changeType: event.changeType },
        ],
      };

    case "agent_stall_warning":
      return {
        ...state,
        lastEventAt: now,
        stallWarning: {
          lastEventAt: event.lastEventAt,
          stallDurationSeconds: event.stallDurationSeconds,
        },
      };

    case "agent_token":
      return {
        ...state,
        lastEventAt: now,
        stallWarning: undefined,
        outputEntries: [
          ...state.outputEntries,
          { kind: "token", text: event.token },
        ],
      };

    case "agent_prompt":
      return {
        ...state,
        lastEventAt: now,
        stallWarning: undefined,
        outputEntries: [
          { kind: "prompt", text: event.text },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export type UseAgentSessionReturn = {
  state: AgentSessionState;
  close: () => void;
};

// ---------------------------------------------------------------------------
// Hook: effect boundary (EventSource lifecycle + stall timer)
// ---------------------------------------------------------------------------

export function useAgentSession(
  streamUrl: string | undefined,
  startedAt: string,
): UseAgentSessionReturn {
  const [state, setState] = useState<AgentSessionState>(() =>
    createInitialState(startedAt),
  );
  const eventSourceRef = useRef<EventSource | undefined>(undefined);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Timer lifecycle: clearStallTimer is stable (no deps). resetStallTimer depends only on
  // clearStallTimer, so it is also stable. Both use stallTimerRef (a ref, not state) to avoid
  // stale closures. setState updater form ensures state reads are always current.
  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current !== undefined) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = undefined;
    }
  }, []);

  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      setState((prev) => ({
        ...prev,
        stallWarning: {
          lastEventAt: prev.lastEventAt ?? prev.startedAt,
          stallDurationSeconds: STALL_TIMEOUT_MS / 1000,
        },
      }));
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  useEffect(() => {
    if (!streamUrl) return;

    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    // SSE registry sends unnamed events (data-only, no event: field).
    // Use onmessage and dispatch on the parsed type.
    eventSource.onmessage = (e) => {
      resetStallTimer();

      try {
        const data = JSON.parse(e.data);
        const eventType = data.type as string | undefined;
        if (!eventType) return;

        const event: AgentEvent = data as AgentEvent;
        setState((prev) => reduceAgentSessionEvent(prev, event));

        // Close on terminal status
        if (eventType === "agent_status" && isTerminalStatus(data.status)) {
          eventSource.close();
          clearStallTimer();
        }
      } catch {
        // Malformed event data -- state not updated but stall timer is reset
        console.warn("Failed to parse SSE event data");
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      clearStallTimer();
      setState((prev) => ({
        ...prev,
        status: "error",
        connectionError: "Connection lost",
      }));
    };

    // Start stall timer
    resetStallTimer();

    return () => {
      eventSource.close();
      eventSourceRef.current = undefined;
      clearStallTimer();
    };
  }, [streamUrl, resetStallTimer, clearStallTimer]);

  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = undefined;
    }
    clearStallTimer();
  }, [clearStallTimer]);

  return { state, close };
}
