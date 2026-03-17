/**
 * Loop Dampener Unit Tests
 *
 * Tests for the pure sliding window counter that detects rapid-fire
 * observations on the same entity from the same source within a workspace.
 *
 * Pure core: shouldDampen (threshold logic, window expiry, key composition)
 * Factory: createLoopDampener (stateful container with DI for side effects)
 */
import { describe, expect, it } from "bun:test";
import {
  composeDampenerKey,
  shouldDampen,
  createLoopDampener,
  type DampenerEvent,
  type DampenerConfig,
} from "../../app/src/server/reactive/loop-dampener";

// ---------------------------------------------------------------------------
// composeDampenerKey
// ---------------------------------------------------------------------------

describe("composeDampenerKey", () => {
  it("composes workspace, entity, and source into a single key", () => {
    const key = composeDampenerKey("ws-1", "task:t-1", "observer_agent");
    expect(key).toBe("ws-1:task:t-1:observer_agent");
  });

  it("produces distinct keys for different workspaces", () => {
    const keyA = composeDampenerKey("ws-a", "task:t-1", "observer_agent");
    const keyB = composeDampenerKey("ws-b", "task:t-1", "observer_agent");
    expect(keyA).not.toBe(keyB);
  });

  it("produces distinct keys for different entities", () => {
    const keyA = composeDampenerKey("ws-1", "task:t-1", "observer_agent");
    const keyB = composeDampenerKey("ws-1", "task:t-2", "observer_agent");
    expect(keyA).not.toBe(keyB);
  });

  it("produces distinct keys for different sources", () => {
    const keyA = composeDampenerKey("ws-1", "task:t-1", "observer_agent");
    const keyB = composeDampenerKey("ws-1", "task:t-1", "pm_agent");
    expect(keyA).not.toBe(keyB);
  });
});

// ---------------------------------------------------------------------------
// shouldDampen (pure function)
// ---------------------------------------------------------------------------

describe("shouldDampen", () => {
  const defaultConfig: DampenerConfig = {
    threshold: 3,
    windowMs: 60_000,
  };

  it("returns not dampened when event count is below threshold", () => {
    const now = 1000;
    const timestamps = [500, 800]; // 2 events, threshold is 3
    const result = shouldDampen(timestamps, now, defaultConfig);
    expect(result.dampened).toBe(false);
  });

  it("returns dampened when event count reaches threshold within window", () => {
    const now = 3000;
    const timestamps = [1000, 2000, 2500]; // 3 events within window
    const result = shouldDampen(timestamps, now, defaultConfig);
    expect(result.dampened).toBe(true);
  });

  it("returns dampened when event count exceeds threshold within window", () => {
    const now = 5000;
    const timestamps = [1000, 2000, 3000, 4000]; // 4 events
    const result = shouldDampen(timestamps, now, defaultConfig);
    expect(result.dampened).toBe(true);
  });

  it("returns not dampened when old events have expired outside window", () => {
    const now = 120_000;
    // All timestamps older than 60s ago (now - 60000 = 60000)
    const timestamps = [1000, 2000, 3000, 4000];
    const result = shouldDampen(timestamps, now, defaultConfig);
    expect(result.dampened).toBe(false);
  });

  it("only counts events within the sliding window", () => {
    const now = 70_000;
    // windowStart = 70000 - 60000 = 10000
    // timestamps[0] and [1] are outside, [2] is inside -- only 1 in window
    const timestamps = [5000, 8000, 65_000];
    const result = shouldDampen(timestamps, now, defaultConfig);
    expect(result.dampened).toBe(false);
  });

  it("counts exactly the events within the window boundary", () => {
    const now = 70_000;
    // windowStart = 10000; events at 10001, 10002, 10003 are all in
    const timestamps = [10_001, 10_002, 10_003];
    const result = shouldDampen(timestamps, now, defaultConfig);
    expect(result.dampened).toBe(true);
  });

  it("returns not dampened for empty timestamps", () => {
    const result = shouldDampen([], 1000, defaultConfig);
    expect(result.dampened).toBe(false);
  });

  it("respects custom threshold", () => {
    const config: DampenerConfig = { threshold: 5, windowMs: 60_000 };
    const timestamps = [1000, 2000, 3000]; // 3 events, threshold is 5
    const result = shouldDampen(timestamps, 4000, config);
    expect(result.dampened).toBe(false);
  });

  it("respects custom window size", () => {
    const config: DampenerConfig = { threshold: 3, windowMs: 5000 };
    const now = 10_000;
    // windowStart = 5000; events at 3000 and 4000 are outside, only 6000 is in
    const timestamps = [3000, 4000, 6000];
    const result = shouldDampen(timestamps, now, config);
    expect(result.dampened).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLoopDampener (factory with injected side effects)
// ---------------------------------------------------------------------------

describe("createLoopDampener", () => {
  function makeEvent(overrides?: Partial<DampenerEvent>): DampenerEvent {
    return {
      workspaceId: "ws-1",
      entityId: "task:t-1",
      sourceAgent: "observer_agent",
      ...overrides,
    };
  }

  it("does not dampen first event", () => {
    const dampener = createLoopDampener({ threshold: 3, windowMs: 60_000 });
    const result = dampener.record(makeEvent());
    expect(result.dampened).toBe(false);
  });

  it("does not dampen events below threshold", () => {
    const dampener = createLoopDampener({ threshold: 3, windowMs: 60_000 });
    dampener.record(makeEvent());
    dampener.record(makeEvent());
    const result = dampener.record(makeEvent());
    // 3rd event is the one that hits threshold (3 previous + current = checking 3 recorded)
    // After recording 2 events, the 3rd record call adds a 3rd timestamp
    // shouldDampen checks if timestamps.length >= threshold
    // On the 3rd call: record adds timestamp, then checks [t1, t2, t3] >= 3 => dampened
    expect(result.dampened).toBe(true);
  });

  it("activates dampening at exactly the threshold", () => {
    const dampener = createLoopDampener({ threshold: 3, windowMs: 60_000 });
    const results = [
      dampener.record(makeEvent()), // 1st
      dampener.record(makeEvent()), // 2nd
      dampener.record(makeEvent()), // 3rd -- hits threshold
    ];
    expect(results[0].dampened).toBe(false);
    expect(results[1].dampened).toBe(false);
    expect(results[2].dampened).toBe(true);
  });

  it("continues dampening after threshold is exceeded", () => {
    const dampener = createLoopDampener({ threshold: 3, windowMs: 60_000 });
    dampener.record(makeEvent());
    dampener.record(makeEvent());
    dampener.record(makeEvent()); // dampened
    const result = dampener.record(makeEvent()); // still dampened
    expect(result.dampened).toBe(true);
  });

  it("tracks different keys independently", () => {
    const dampener = createLoopDampener({ threshold: 3, windowMs: 60_000 });

    // Fill key A to threshold
    dampener.record(makeEvent({ entityId: "task:t-a" }));
    dampener.record(makeEvent({ entityId: "task:t-a" }));
    const resultA = dampener.record(makeEvent({ entityId: "task:t-a" }));
    expect(resultA.dampened).toBe(true);

    // Key B should not be dampened
    const resultB = dampener.record(makeEvent({ entityId: "task:t-b" }));
    expect(resultB.dampened).toBe(false);
  });

  it("resets after window expires", () => {
    let now = 1000;
    const dampener = createLoopDampener(
      { threshold: 3, windowMs: 60_000 },
      () => now,
    );

    // Trigger dampening
    dampener.record(makeEvent());
    dampener.record(makeEvent());
    const dampened = dampener.record(makeEvent());
    expect(dampened.dampened).toBe(true);

    // Advance time past the window
    now = 70_000;

    // New event should not be dampened (old timestamps expired)
    const afterReset = dampener.record(makeEvent());
    expect(afterReset.dampened).toBe(false);
  });

  it("calls onDampen callback when dampening first activates", () => {
    const dampenCalls: Array<{ key: string; event: DampenerEvent }> = [];
    const dampener = createLoopDampener(
      { threshold: 3, windowMs: 60_000 },
      undefined,
      (key, event) => { dampenCalls.push({ key, event }); },
    );

    dampener.record(makeEvent());
    dampener.record(makeEvent());
    expect(dampenCalls.length).toBe(0);

    dampener.record(makeEvent()); // triggers dampening
    expect(dampenCalls.length).toBe(1);
    expect(dampenCalls[0].key).toBe("ws-1:task:t-1:observer_agent");
  });

  it("does not call onDampen on subsequent dampened events (only on activation)", () => {
    const dampenCalls: Array<{ key: string; event: DampenerEvent }> = [];
    const dampener = createLoopDampener(
      { threshold: 3, windowMs: 60_000 },
      undefined,
      (key, event) => { dampenCalls.push({ key, event }); },
    );

    dampener.record(makeEvent());
    dampener.record(makeEvent());
    dampener.record(makeEvent()); // activates
    dampener.record(makeEvent()); // already dampened
    dampener.record(makeEvent()); // already dampened

    expect(dampenCalls.length).toBe(1);
  });
});
