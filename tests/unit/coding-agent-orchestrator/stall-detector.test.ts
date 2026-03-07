/**
 * Unit tests for stall-detector: pure timeout/step-count logic with injectable clock.
 *
 * Tests the pure check functions and the effectful handle that manages timers.
 * Dependencies are injected as function stubs (no mock libraries).
 */
import { describe, expect, it } from "bun:test";
import {
  checkStallTimeout,
  checkStepLimit,
  startStallDetector,
  type StallDetectorConfig,
  type StallDetectorDeps,
  type StallCheckInput,
} from "../../../app/src/server/orchestrator/stall-detector";

// ---------------------------------------------------------------------------
// Default config for tests
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: StallDetectorConfig = {
  stallTimeoutMs: 300_000, // 5 minutes
  maxSteps: 100,
  checkIntervalMs: 30_000,
};

const SHORT_CONFIG: StallDetectorConfig = {
  stallTimeoutMs: 5_000,
  maxSteps: 3,
  checkIntervalMs: 1_000,
};

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

type StubDeps = StallDetectorDeps & {
  abortedSessions: string[];
  observations: Array<{ text: string; severity: string }>;
  emittedEvents: Array<{ streamId: string; event: unknown }>;
};

function stubDeps(overrides: Partial<StallDetectorDeps> = {}): StubDeps {
  const abortedSessions: string[] = [];
  const observations: Array<{ text: string; severity: string }> = [];
  const emittedEvents: Array<{ streamId: string; event: unknown }> = [];

  return {
    abortSession: async (sessionId) => {
      abortedSessions.push(sessionId);
      return { ok: true as const, value: { aborted: true, sessionId } };
    },
    createObservation: async (input) => {
      observations.push({ text: input.text, severity: input.severity });
    },
    emitEvent: (streamId, event) => {
      emittedEvents.push({ streamId, event });
    },
    abortedSessions,
    observations,
    emittedEvents,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure function: checkStallTimeout
// ---------------------------------------------------------------------------

describe("checkStallTimeout", () => {
  it("returns stalled when elapsed time exceeds timeout", () => {
    const input: StallCheckInput = {
      lastActivityAt: 0,
      nowMs: 400_000,
      stallTimeoutMs: 300_000,
    };

    const result = checkStallTimeout(input);

    expect(result.stalled).toBe(true);
    expect(result.stallDurationMs).toBe(400_000);
  });

  it("returns not stalled when elapsed time is within timeout", () => {
    const input: StallCheckInput = {
      lastActivityAt: 100_000,
      nowMs: 200_000,
      stallTimeoutMs: 300_000,
    };

    const result = checkStallTimeout(input);

    expect(result.stalled).toBe(false);
  });

  it("returns not stalled when elapsed time exactly equals timeout", () => {
    const input: StallCheckInput = {
      lastActivityAt: 0,
      nowMs: 300_000,
      stallTimeoutMs: 300_000,
    };

    const result = checkStallTimeout(input);

    expect(result.stalled).toBe(false);
  });

  it("returns stalled at one millisecond past timeout", () => {
    const input: StallCheckInput = {
      lastActivityAt: 0,
      nowMs: 300_001,
      stallTimeoutMs: 300_000,
    };

    const result = checkStallTimeout(input);

    expect(result.stalled).toBe(true);
    expect(result.stallDurationMs).toBe(300_001);
  });
});

// ---------------------------------------------------------------------------
// Pure function: checkStepLimit
// ---------------------------------------------------------------------------

describe("checkStepLimit", () => {
  it("returns exceeded when step count is above max", () => {
    const result = checkStepLimit(101, 100);

    expect(result.exceeded).toBe(true);
  });

  it("returns not exceeded when step count is at max", () => {
    const result = checkStepLimit(100, 100);

    expect(result.exceeded).toBe(false);
  });

  it("returns not exceeded when step count is below max", () => {
    const result = checkStepLimit(50, 100);

    expect(result.exceeded).toBe(false);
  });

  it("returns exceeded at max plus one", () => {
    const result = checkStepLimit(101, 100);

    expect(result.exceeded).toBe(true);
    expect(result.currentSteps).toBe(101);
    expect(result.maxSteps).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Handle: startStallDetector
// ---------------------------------------------------------------------------

describe("startStallDetector", () => {
  const sessionId = "sess-stall-1";
  const streamId = "stream-sess-stall-1";

  it("does not abort when activity is recent", () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => 1000,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    // Record activity at t=1000
    handle.recordActivity();

    // Timer fires at t=1000 (same time as activity)
    timers[0]?.();

    expect(deps.abortedSessions).toHaveLength(0);
    expect(deps.observations).toHaveLength(0);

    handle.stop();
  });

  it("aborts session when no activity within timeout", async () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    let currentTime = 0;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => currentTime,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    // Record activity at t=0
    handle.recordActivity();

    // Advance time past timeout
    currentTime = 6_000;

    // Timer fires
    timers[0]?.();

    // Allow async abort to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(deps.abortedSessions).toContain(sessionId);
  });

  it("creates warning observation when stall detected", async () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    let currentTime = 0;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => currentTime,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    handle.recordActivity();
    currentTime = 6_000;
    timers[0]?.();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(deps.observations).toHaveLength(1);
    expect(deps.observations[0].severity).toBe("warning");
    expect(deps.observations[0].text).toContain("stall");

    handle.stop();
  });

  it("emits AgentStallWarningEvent when stall detected", async () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    let currentTime = 0;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => currentTime,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    handle.recordActivity();
    currentTime = 6_000;
    timers[0]?.();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(deps.emittedEvents).toHaveLength(1);
    const event = deps.emittedEvents[0].event as { type: string; sessionId: string };
    expect(event.type).toBe("agent_stall_warning");
    expect(event.sessionId).toBe(sessionId);
    expect(deps.emittedEvents[0].streamId).toBe(streamId);

    handle.stop();
  });

  it("aborts session when step count exceeds max", async () => {
    const deps = stubDeps();
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => 0,
      setInterval: (_cb, _ms) => 1 as unknown as ReturnType<typeof globalThis.setInterval>,
      clearInterval: () => {},
    });

    // Increment steps past max (3)
    handle.incrementStepCount();
    handle.incrementStepCount();
    handle.incrementStepCount();

    // Allow async abort to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Step count at 3 = max, not exceeded
    expect(deps.abortedSessions).toHaveLength(0);

    // One more pushes past limit
    handle.incrementStepCount();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(deps.abortedSessions).toContain(sessionId);

    handle.stop();
  });

  it("creates observation when step limit exceeded", async () => {
    const deps = stubDeps();
    const handle = startStallDetector(deps, { ...SHORT_CONFIG, maxSteps: 1 }, sessionId, streamId, {
      now: () => 0,
      setInterval: (_cb, _ms) => 1 as unknown as ReturnType<typeof globalThis.setInterval>,
      clearInterval: () => {},
    });

    handle.incrementStepCount();
    handle.incrementStepCount();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(deps.observations).toHaveLength(1);
    expect(deps.observations[0].severity).toBe("warning");
    expect(deps.observations[0].text).toContain("step");

    handle.stop();
  });

  it("active agent with recent activity is not falsely detected", () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    let currentTime = 0;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => currentTime,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    // Simulate active agent: record activity before each check
    handle.recordActivity();
    currentTime = 2_000;
    handle.recordActivity(); // activity at t=2000
    currentTime = 4_000;
    timers[0]?.(); // check at t=4000, last activity at t=2000, elapsed=2000 < 5000

    expect(deps.abortedSessions).toHaveLength(0);
    expect(deps.observations).toHaveLength(0);

    handle.stop();
  });

  it("clears interval timer on stop", () => {
    const deps = stubDeps();
    let clearedId: unknown;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => 0,
      setInterval: (_cb, _ms) => 42 as unknown as ReturnType<typeof globalThis.setInterval>,
      clearInterval: (id) => {
        clearedId = id;
      },
    });

    handle.stop();

    expect(clearedId).toBe(42);
  });

  it("does not abort twice after stop", async () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    let currentTime = 0;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => currentTime,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    handle.recordActivity();
    currentTime = 6_000;

    // Stop before timer fires
    handle.stop();

    // Timer fires after stop
    timers[0]?.();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(deps.abortedSessions).toHaveLength(0);
  });

  it("recordActivity resets the stall timer", async () => {
    const deps = stubDeps();
    const timers: Array<() => void> = [];
    let currentTime = 0;
    const handle = startStallDetector(deps, SHORT_CONFIG, sessionId, streamId, {
      now: () => currentTime,
      setInterval: (cb, _ms) => {
        timers.push(cb as () => void);
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });

    // Activity at t=0
    handle.recordActivity();

    // Advance to t=4000 (within timeout), record new activity
    currentTime = 4_000;
    handle.recordActivity();

    // Advance to t=8000 -- 8s since start but only 4s since last activity
    currentTime = 8_000;
    timers[0]?.();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should NOT be stalled (4000ms < 5000ms timeout)
    expect(deps.abortedSessions).toHaveLength(0);

    handle.stop();
  });
});
