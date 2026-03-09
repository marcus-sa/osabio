import type { Surreal } from "surrealdb";
import type { ServerConfig } from "./config";
import type { SseRegistry } from "../streaming/sse-registry";
import type { Auth } from "../auth/config";

export type InflightTracker = {
  track(promise: Promise<unknown>): void;
  drain(timeoutMs?: number): Promise<void>;
};

export function createInflightTracker(): InflightTracker {
  const pending = new Set<Promise<unknown>>();
  return {
    track(promise) {
      pending.add(promise);
      promise.finally(() => pending.delete(promise));
    },
    async drain(timeoutMs = 30_000) {
      if (pending.size === 0) return;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}

export type ServerDependencies = {
  config: ServerConfig;
  surreal: Surreal;
  analyticsSurreal: Surreal;
  auth: Auth;
  chatAgentModel: any;
  extractionModel: any;
  pmAgentModel: any;
  analyticsAgentModel: any;
  embeddingModel: any;
  sse: SseRegistry;
  inflight: InflightTracker;
};
