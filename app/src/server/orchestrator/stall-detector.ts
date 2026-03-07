/**
 * Stall detector: monitors agent session activity and step counts.
 *
 * Pure check functions (checkStallTimeout, checkStepLimit) + effectful handle
 * (startStallDetector) that manages timers and triggers abort/observation.
 *
 * Timer and clock are injectable for testability.
 */
import type { StreamEvent, AgentStallWarningEvent } from "../../shared/contracts";
import type { AbortSessionResult } from "./session-lifecycle";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type StallDetectorConfig = {
  stallTimeoutMs: number;     // default: 300_000 (5 minutes)
  maxSteps: number;           // default: 100
  checkIntervalMs: number;    // default: 30_000 (30 seconds)
};

export const DEFAULT_STALL_CONFIG: StallDetectorConfig = {
  stallTimeoutMs: 300_000,
  maxSteps: 100,
  checkIntervalMs: 30_000,
};

// ---------------------------------------------------------------------------
// Ports: dependencies as function signatures
// ---------------------------------------------------------------------------

export type ObservationInput = {
  text: string;
  severity: "info" | "warning" | "conflict";
  category: string;
  sourceAgent: string;
};

export type StallDetectorDeps = {
  abortSession: (sessionId: string) => Promise<AbortSessionResult>;
  createObservation: (input: ObservationInput) => Promise<void>;
  emitEvent: (streamId: string, event: StreamEvent) => void;
};

// ---------------------------------------------------------------------------
// Injectable clock/timer for testability
// ---------------------------------------------------------------------------

export type Clock = {
  now: () => number;
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval: (id: ReturnType<typeof globalThis.setInterval>) => void;
};

const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

export type StallDetectorHandle = {
  recordActivity: () => void;
  incrementStepCount: () => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// Pure check: timeout
// ---------------------------------------------------------------------------

export type StallCheckInput = {
  lastActivityAt: number;
  nowMs: number;
  stallTimeoutMs: number;
};

export type StallCheckResult = {
  stalled: boolean;
  stallDurationMs?: number;
};

export function checkStallTimeout(input: StallCheckInput): StallCheckResult {
  const elapsed = input.nowMs - input.lastActivityAt;
  if (elapsed > input.stallTimeoutMs) {
    return { stalled: true, stallDurationMs: elapsed };
  }
  return { stalled: false };
}

// ---------------------------------------------------------------------------
// Pure check: step limit
// ---------------------------------------------------------------------------

export type StepLimitResult = {
  exceeded: boolean;
  currentSteps: number;
  maxSteps: number;
};

export function checkStepLimit(currentSteps: number, maxSteps: number): StepLimitResult {
  return {
    exceeded: currentSteps > maxSteps,
    currentSteps,
    maxSteps,
  };
}

// ---------------------------------------------------------------------------
// Effectful handle factory
// ---------------------------------------------------------------------------

export function startStallDetector(
  deps: StallDetectorDeps,
  config: StallDetectorConfig,
  sessionId: string,
  streamId: string,
  clock: Clock = SYSTEM_CLOCK,
): StallDetectorHandle {
  let stopped = false;
  let aborted = false;
  let lastActivityAt = clock.now();
  let stepCount = 0;

  async function handleStall(reason: string, observation: string): Promise<void> {
    if (aborted || stopped) return;
    aborted = true;

    const stallWarning: AgentStallWarningEvent = {
      type: "agent_stall_warning",
      sessionId,
      lastEventAt: new Date(lastActivityAt).toISOString(),
      stallDurationSeconds: Math.round((clock.now() - lastActivityAt) / 1000),
    };

    deps.emitEvent(streamId, stallWarning);
    await deps.abortSession(sessionId);
    await deps.createObservation({
      text: observation,
      severity: "warning",
      category: "stall_detection",
      sourceAgent: "orchestrator",
    });
  }

  function checkTimeout(): void {
    if (stopped || aborted) return;

    const result = checkStallTimeout({
      lastActivityAt,
      nowMs: clock.now(),
      stallTimeoutMs: config.stallTimeoutMs,
    });

    if (result.stalled) {
      const durationSec = Math.round((result.stallDurationMs ?? 0) / 1000);
      handleStall(
        "timeout",
        `Agent session stalled: no activity for ${durationSec} seconds`,
      );
    }
  }

  const intervalId = clock.setInterval(checkTimeout, config.checkIntervalMs);

  return {
    recordActivity(): void {
      if (stopped) return;
      lastActivityAt = clock.now();
    },

    incrementStepCount(): void {
      if (stopped || aborted) return;
      stepCount += 1;

      const result = checkStepLimit(stepCount, config.maxSteps);
      if (result.exceeded) {
        handleStall(
          "step_limit",
          `Agent session exceeded maximum step count: ${stepCount}/${config.maxSteps} steps`,
        );
      }
    },

    stop(): void {
      stopped = true;
      clock.clearInterval(intervalId);
    },
  };
}
