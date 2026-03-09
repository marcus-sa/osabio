import type { IntentRecord, IntentStatus } from "./types";

// --- Veto Event Types ---

export type VetoEvent =
  | { type: "veto_window_opened"; intentId: string; expiresAt: Date }
  | { type: "veto_auto_approved"; intentId: string }
  | { type: "veto_cancelled"; intentId: string };

// --- Dependency Ports ---

export type VetoManagerDeps = {
  updateStatus: (
    intentId: string,
    status: IntentStatus,
  ) => Promise<{ ok: true; record: IntentRecord } | { ok: false; error: string }>;
  emitVetoEvent: (event: VetoEvent) => void;
  queryExpiredVetoIntents: () => Promise<IntentRecord[]>;
};

// --- VetoManager Interface ---

export type VetoManager = {
  startVetoWindow: (intentId: string, expiresAt: Date, deps: VetoManagerDeps) => void;
  cancelVetoWindow: (intentId: string) => void;
  recoverExpiredWindows: (deps: VetoManagerDeps) => Promise<void>;
  shutdown: () => void;
  activeWindowCount: () => number;
};

// --- Configuration ---

type VetoManagerConfig = {
  vetoDurationMs?: number;
};

// --- Factory ---

export function createVetoManager(_config?: VetoManagerConfig): VetoManager {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const autoApprove = async (intentId: string, deps: VetoManagerDeps): Promise<void> => {
    timers.delete(intentId);
    await deps.updateStatus(intentId, "authorized");
    deps.emitVetoEvent({ type: "veto_auto_approved", intentId });
  };

  return {
    startVetoWindow(intentId: string, expiresAt: Date, deps: VetoManagerDeps): void {
      const delayMs = Math.max(0, expiresAt.getTime() - Date.now());

      const timer = setTimeout(() => {
        autoApprove(intentId, deps);
      }, delayMs);

      timers.set(intentId, timer);

      deps.emitVetoEvent({
        type: "veto_window_opened",
        intentId,
        expiresAt,
      });
    },

    cancelVetoWindow(intentId: string): void {
      const timer = timers.get(intentId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(intentId);
      }
    },

    async recoverExpiredWindows(deps: VetoManagerDeps): Promise<void> {
      const expired = await deps.queryExpiredVetoIntents();
      for (const intent of expired) {
        const intentId = intent.id.id as string;
        await autoApprove(intentId, deps);
      }
    },

    shutdown(): void {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    },

    activeWindowCount(): number {
      return timers.size;
    },
  };
}
