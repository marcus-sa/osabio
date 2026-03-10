import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  createVetoManager,
  type VetoManagerDeps,
  type VetoEvent,
  type VetoManager,
} from "../../../app/src/server/intent/veto-manager";
import type { IntentRecord, IntentStatus } from "../../../app/src/server/intent/types";
import { RecordId } from "surrealdb";

// --- Test Helpers ---

type RecordedCall = { intentId: string; status: IntentStatus };

const makeIntentRecord = (
  id: string,
  status: IntentStatus,
  vetoExpiresAt?: Date,
): IntentRecord => ({
  id: new RecordId("intent", id),
  goal: "Test goal",
  reasoning: "Test reasoning",
  status,
  priority: 5,
  action_spec: { provider: "test", action: "do_thing" },
  trace_id: new RecordId("trace", "trace-1"),
  requester: new RecordId("identity", "user-1"),
  workspace: new RecordId("workspace", "ws-1"),
  created_at: new Date("2026-01-01"),
  ...(vetoExpiresAt ? { veto_expires_at: vetoExpiresAt } : {}),
});

const makeDeps = (): {
  deps: VetoManagerDeps;
  statusUpdates: RecordedCall[];
  emittedEvents: VetoEvent[];
  expiredQueryResults: IntentRecord[];
} => {
  const statusUpdates: RecordedCall[] = [];
  const emittedEvents: VetoEvent[] = [];
  const expiredQueryResults: IntentRecord[] = [];

  const deps: VetoManagerDeps = {
    updateStatus: async (intentId, status) => {
      statusUpdates.push({ intentId, status });
      return { ok: true, record: makeIntentRecord(intentId, status) };
    },
    emitVetoEvent: (event) => {
      emittedEvents.push(event);
    },
    queryExpiredVetoIntents: async () => expiredQueryResults,
  };

  return { deps, statusUpdates, emittedEvents, expiredQueryResults };
};

// --- Tests ---

describe("VetoManager", () => {
  let manager: VetoManager;
  const VETO_DURATION_MS = 80;

  afterEach(() => {
    manager?.shutdown();
  });

  describe("startVetoWindow", () => {
    test("emits veto_window_opened event", () => {
      const { deps, emittedEvents } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      const expiresAt = new Date(Date.now() + VETO_DURATION_MS);
      manager.startVetoWindow("intent-1", expiresAt, deps);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("veto_window_opened");
      expect(emittedEvents[0].intentId).toBe("intent-1");
      expect(emittedEvents[0].expiresAt).toEqual(expiresAt);
    });

    test("auto-approves intent after timer expires", async () => {
      const { deps, statusUpdates, emittedEvents } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      const expiresAt = new Date(Date.now() + 50);
      manager.startVetoWindow("intent-2", expiresAt, deps);

      // Wait for timer expiry
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(statusUpdates).toHaveLength(1);
      expect(statusUpdates[0]).toEqual({ intentId: "intent-2", status: "authorized" });

      // Should emit auto_approved event
      const approvedEvent = emittedEvents.find((e) => e.type === "veto_auto_approved");
      expect(approvedEvent).toBeDefined();
      expect(approvedEvent!.intentId).toBe("intent-2");
    });

    test("does not auto-approve if window is cancelled before expiry", async () => {
      const { deps, statusUpdates } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      const expiresAt = new Date(Date.now() + 200);
      manager.startVetoWindow("intent-3", expiresAt, deps);

      // Cancel before expiry
      manager.cancelVetoWindow("intent-3");

      await new Promise((resolve) => setTimeout(resolve, 250));

      // No status update should have occurred (cancel does not update status itself)
      expect(statusUpdates).toHaveLength(0);
    });
  });

  describe("cancelVetoWindow", () => {
    test("removes the timer for the given intent", () => {
      const { deps } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      const expiresAt = new Date(Date.now() + 500);
      manager.startVetoWindow("intent-4", expiresAt, deps);

      expect(manager.activeWindowCount()).toBe(1);
      manager.cancelVetoWindow("intent-4");
      expect(manager.activeWindowCount()).toBe(0);
    });

    test("is a no-op for unknown intent ids", () => {
      const { deps } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      // Should not throw
      manager.cancelVetoWindow("nonexistent");
      expect(manager.activeWindowCount()).toBe(0);
    });
  });

  describe("recoverExpiredWindows", () => {
    test("auto-approves all expired pending_veto intents", async () => {
      const { deps, statusUpdates, emittedEvents, expiredQueryResults } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      // Simulate two expired intents found in DB
      const pastDate = new Date(Date.now() - 60_000);
      expiredQueryResults.push(
        makeIntentRecord("expired-1", "pending_veto", pastDate),
        makeIntentRecord("expired-2", "pending_veto", pastDate),
      );

      await manager.recoverExpiredWindows(deps);

      expect(statusUpdates).toHaveLength(2);
      expect(statusUpdates[0]).toEqual({ intentId: "expired-1", status: "authorized" });
      expect(statusUpdates[1]).toEqual({ intentId: "expired-2", status: "authorized" });

      // Should emit recovery events
      const recoveryEvents = emittedEvents.filter((e) => e.type === "veto_auto_approved");
      expect(recoveryEvents).toHaveLength(2);
    });

    test("handles empty result set gracefully", async () => {
      const { deps, statusUpdates } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      await manager.recoverExpiredWindows(deps);

      expect(statusUpdates).toHaveLength(0);
    });
  });

  describe("shutdown", () => {
    test("clears all active timers", async () => {
      const { deps, statusUpdates } = makeDeps();
      manager = createVetoManager({ vetoDurationMs: VETO_DURATION_MS });

      manager.startVetoWindow("s-1", new Date(Date.now() + 200), deps);
      manager.startVetoWindow("s-2", new Date(Date.now() + 200), deps);

      expect(manager.activeWindowCount()).toBe(2);

      manager.shutdown();

      expect(manager.activeWindowCount()).toBe(0);

      // Wait past expiry -- no auto-approvals should fire
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(statusUpdates).toHaveLength(0);
    });
  });
});
