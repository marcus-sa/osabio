/**
 * Event Stream Wiring: unit tests for startEventIteration
 *
 * Step 02-01: Migrated from OpencodeEvent to SdkMessage types
 *
 * Verifies that SDK messages flow through the event bridge,
 * session transitions to active on first message, stall detector
 * receives signals, and iteration stops on terminal status or error.
 */
import { describe, expect, test } from "bun:test";
import {
  startEventIteration,
  type EventIterationDeps,
} from "../../../app/src/server/orchestrator/session-lifecycle";
import type { SdkMessage } from "../../../app/src/server/orchestrator/event-bridge";
import type { OrchestratorStatus } from "../../../app/src/server/orchestrator/types";

// ---------------------------------------------------------------------------
// Test helpers: async generators that simulate SDK message streams
// ---------------------------------------------------------------------------

function createSdkMessageStream(
  messages: SdkMessage[],
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

function createDelayedMessageStream(
  entries: Array<{ message: SdkMessage; delayMs: number }>,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const { message, delayMs } of entries) {
        await Bun.sleep(delayMs);
        yield message;
      }
    },
  };
}

function createErrorStream(
  messagesBeforeError: SdkMessage[],
  error: Error,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messagesBeforeError) {
        yield msg;
      }
      throw error;
    },
  };
}

// ---------------------------------------------------------------------------
// Spy factory for EventIterationDeps
// ---------------------------------------------------------------------------

type DepsSpy = {
  deps: EventIterationDeps;
  emittedEvents: Array<{ streamId: string; event: unknown }>;
  statusUpdates: Array<{ sessionId: string; status: OrchestratorStatus; error?: string }>;
  lastEventAtCalls: string[];
  stallDetectorStarted: boolean;
  stallActivityCalls: number;
  stallStepCalls: number;
  stallStopped: boolean;
};

function createDepsSpy(options?: {
  sessionStatus?: OrchestratorStatus;
}): DepsSpy {
  const spy: DepsSpy = {
    deps: undefined as unknown as EventIterationDeps,
    emittedEvents: [],
    statusUpdates: [],
    lastEventAtCalls: [],
    stallDetectorStarted: false,
    stallActivityCalls: 0,
    stallStepCalls: 0,
    stallStopped: false,
  };

  spy.deps = {
    emitEvent: (streamId: string, event: unknown) => {
      spy.emittedEvents.push({ streamId, event });
    },
    updateSessionStatus: async (
      sessionId: string,
      status: OrchestratorStatus,
      error?: string,
    ) => {
      spy.statusUpdates.push({ sessionId, status, ...(error ? { error } : {}) });
    },
    updateLastEventAt: async (sessionId: string) => {
      spy.lastEventAtCalls.push(sessionId);
    },
    getSessionStatus: async (_sessionId: string) => {
      return options?.sessionStatus ?? "spawning";
    },
    startStallDetector: (_sessionId: string, _streamId: string) => ({
      recordActivity: () => { spy.stallActivityCalls++; },
      incrementStepCount: () => { spy.stallStepCalls++; },
      stop: () => { spy.stallStopped = true; },
    }),
  };

  spy.stallDetectorStarted = false;
  const originalStart = spy.deps.startStallDetector;
  spy.deps.startStallDetector = (sessionId, streamId) => {
    spy.stallDetectorStarted = true;
    return originalStart(sessionId, streamId);
  };

  return spy;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startEventIteration (step 02-01: SDK messages)", () => {

  // -------------------------------------------------------------------------
  // Behavior 1: SDK messages are forwarded through event bridge to SSE
  // -------------------------------------------------------------------------
  test("forwards SDK assistant messages through event bridge to emitEvent", async () => {
    const messages: SdkMessage[] = [
      { type: "assistant", content: [{ type: "text", text: "Hello" }] },
      { type: "assistant", content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "src/index.ts" } }] },
    ];
    const spy = createDepsSpy();

    const done = startEventIteration(
      spy.deps,
      createSdkMessageStream(messages),
      "stream-1",
      "sess-1",
    );

    await done;

    // Both messages should have produced events
    expect(spy.emittedEvents.length).toBeGreaterThanOrEqual(2);
    expect(spy.emittedEvents[0].streamId).toBe("stream-1");

    // First event should be transformed to agent_token
    const firstEvent = spy.emittedEvents[0].event as { type: string };
    expect(firstEvent.type).toBe("agent_token");

    // Second event should be transformed to agent_file_change (Edit tool)
    const secondEvent = spy.emittedEvents[1].event as { type: string };
    expect(secondEvent.type).toBe("agent_file_change");
  });

  // -------------------------------------------------------------------------
  // Behavior 2: Session transitions to active after first message
  // -------------------------------------------------------------------------
  test("transitions session to active after first SDK message", async () => {
    const messages: SdkMessage[] = [
      { type: "assistant", content: [{ type: "text", text: "Starting" }] },
      { type: "assistant", content: [{ type: "text", text: "..." }] },
    ];
    const spy = createDepsSpy();

    const done = startEventIteration(
      spy.deps,
      createSdkMessageStream(messages),
      "stream-1",
      "sess-1",
    );

    await done;

    // Should transition to active exactly once
    const activeUpdates = spy.statusUpdates.filter((u) => u.status === "active");
    expect(activeUpdates).toHaveLength(1);
    expect(activeUpdates[0].sessionId).toBe("sess-1");
  });

  // -------------------------------------------------------------------------
  // Behavior 3: Stall detector starts and receives activity signals
  // -------------------------------------------------------------------------
  test("starts stall detector and records activity for each message", async () => {
    const messages: SdkMessage[] = [
      { type: "assistant", content: [{ type: "text", text: "token" }] },
      { type: "assistant", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "src/app.ts" } }] },
      { type: "assistant", content: [{ type: "text", text: "more" }] },
    ];
    const spy = createDepsSpy();

    const done = startEventIteration(
      spy.deps,
      createSdkMessageStream(messages),
      "stream-1",
      "sess-1",
    );

    await done;

    expect(spy.stallDetectorStarted).toBe(true);
    // Each message triggers recordActivity via event bridge
    expect(spy.stallActivityCalls).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // Behavior 4: Stream error updates session to error status
  // -------------------------------------------------------------------------
  test("updates session to error status when message stream throws", async () => {
    const spy = createDepsSpy();

    const done = startEventIteration(
      spy.deps,
      createErrorStream(
        [{ type: "assistant", content: [{ type: "text", text: "ok" }] }],
        new Error("Connection lost"),
      ),
      "stream-1",
      "sess-1",
    );

    await done;

    // Should transition to error
    const errorUpdates = spy.statusUpdates.filter((u) => u.status === "error");
    expect(errorUpdates).toHaveLength(1);
    expect(errorUpdates[0].error).toContain("Connection lost");
  });

  // -------------------------------------------------------------------------
  // Behavior 5: Iteration stops on terminal session status (abort)
  // -------------------------------------------------------------------------
  test("stops iterating when session status becomes aborted", async () => {
    // Session status returns "aborted" after first message
    let eventCount = 0;
    const spy = createDepsSpy();
    spy.deps.getSessionStatus = async () => {
      eventCount++;
      return eventCount > 1 ? "aborted" : "active";
    };

    const messages = createDelayedMessageStream([
      { message: { type: "assistant", content: [{ type: "text", text: "a" }] }, delayMs: 0 },
      { message: { type: "assistant", content: [{ type: "text", text: "b" }] }, delayMs: 10 },
      { message: { type: "assistant", content: [{ type: "text", text: "c" }] }, delayMs: 10 },
      { message: { type: "assistant", content: [{ type: "text", text: "d" }] }, delayMs: 10 },
    ]);

    const done = startEventIteration(
      spy.deps,
      messages,
      "stream-1",
      "sess-1",
    );

    await done;

    // Should have stopped before processing all 4 messages
    expect(spy.emittedEvents.length).toBeLessThan(4);
    // Stall detector should be stopped on exit
    expect(spy.stallStopped).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Behavior 6: Stall detector stops when stream ends normally
  // -------------------------------------------------------------------------
  test("stops stall detector when message stream ends normally", async () => {
    const messages: SdkMessage[] = [
      { type: "result", subtype: "success", duration_ms: 1000 },
    ];
    const spy = createDepsSpy();

    const done = startEventIteration(
      spy.deps,
      createSdkMessageStream(messages),
      "stream-1",
      "sess-1",
    );

    await done;

    expect(spy.stallStopped).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Behavior 7: last_event_at is updated for each message
  // -------------------------------------------------------------------------
  test("updates last_event_at for each message received", async () => {
    const messages: SdkMessage[] = [
      { type: "assistant", content: [{ type: "text", text: "a" }] },
      { type: "assistant", content: [{ type: "text", text: "b" }] },
    ];
    const spy = createDepsSpy();

    const done = startEventIteration(
      spy.deps,
      createSdkMessageStream(messages),
      "stream-1",
      "sess-1",
    );

    await done;

    expect(spy.lastEventAtCalls).toHaveLength(2);
    expect(spy.lastEventAtCalls[0]).toBe("sess-1");
  });
});
