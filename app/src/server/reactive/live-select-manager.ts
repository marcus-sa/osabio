/**
 * Live Select Manager
 *
 * Subscribes to governance tables via LIVE SELECT on the existing surreal
 * WebSocket connection. Routes events to per-workspace consumers after
 * application-side workspace filtering.
 *
 * SurrealDB v3.0 constraint: LIVE SELECT WHERE clauses do not support
 * bound parameters, so workspace filtering happens application-side.
 *
 * Excluded tables (too high volume): trace, message, extracted_from
 */
import { Table, RecordId, type Surreal, type LiveSubscription } from "surrealdb";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Tables subscribed to via LIVE SELECT. */
export const GOVERNANCE_TABLES = [
  "decision",
  "task",
  "observation",
  "question",
  "suggestion",
  "learning",
  "agent_session",
] as const;

export type GovernanceTable = (typeof GOVERNANCE_TABLES)[number];

/** A normalized event from a LIVE SELECT subscription. */
export type LiveSelectEvent = {
  table: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  recordId: string;
  value: Record<string, unknown>;
};

export type EventConsumer = (event: LiveSelectEvent) => void;

/** Minimal logger interface for observability. */
export type LiveSelectLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Checks whether a LIVE SELECT event value belongs to the given workspace.
 *
 * The workspace field can be a RecordId object or a string like "workspace:ws-123".
 * Returns false for missing/null/undefined values.
 */
export function matchesWorkspace(
  value: Record<string, unknown> | undefined | null,
  workspaceId: string,
): boolean {
  if (!value) return false;

  const workspace = value.workspace;
  if (!workspace) return false;

  // RecordId object (SDK v2)
  if (workspace instanceof RecordId) {
    return (workspace.id as string) === workspaceId;
  }

  // String format "workspace:ws-123"
  if (typeof workspace === "string") {
    const parts = workspace.split(":");
    if (parts.length >= 2) {
      return parts.slice(1).join(":") === workspaceId;
    }
  }

  return false;
}

/**
 * Extracts a string record ID from a RecordId or returns the string as-is.
 */
function extractRecordIdString(recordId: unknown): string {
  if (recordId instanceof RecordId) {
    return `${recordId.table.name}:${recordId.id as string}`;
  }
  return String(recordId);
}

// ---------------------------------------------------------------------------
// Event Router
// ---------------------------------------------------------------------------

export type EventRouter = {
  addConsumer: (workspaceId: string, consumer: EventConsumer) => () => void;
  addGlobalConsumer: (consumer: EventConsumer) => () => void;
  route: (event: LiveSelectEvent) => void;
};

/**
 * Creates an event router that dispatches LiveSelectEvents to
 * per-workspace consumers after filtering by workspace.
 *
 * Pure data structure -- no IO, no side effects beyond calling callbacks.
 */
export function createEventRouter(): EventRouter {
  const workspaceConsumers = new Map<string, Set<EventConsumer>>();
  const globalConsumers = new Set<EventConsumer>();

  function addConsumer(workspaceId: string, consumer: EventConsumer): () => void {
    if (!workspaceConsumers.has(workspaceId)) {
      workspaceConsumers.set(workspaceId, new Set());
    }
    workspaceConsumers.get(workspaceId)!.add(consumer);

    return () => {
      const consumers = workspaceConsumers.get(workspaceId);
      if (consumers) {
        consumers.delete(consumer);
        if (consumers.size === 0) {
          workspaceConsumers.delete(workspaceId);
        }
      }
    };
  }

  function addGlobalConsumer(consumer: EventConsumer): () => void {
    globalConsumers.add(consumer);
    return () => {
      globalConsumers.delete(consumer);
    };
  }

  function route(event: LiveSelectEvent): void {
    // Route to global consumers (no workspace filtering)
    for (const consumer of globalConsumers) {
      try {
        consumer(event);
      } catch {
        // Consumer errors should not break routing
      }
    }

    // Route to workspace-specific consumers
    for (const [workspaceId, consumers] of workspaceConsumers) {
      if (matchesWorkspace(event.value, workspaceId)) {
        for (const consumer of consumers) {
          try {
            consumer(event);
          } catch {
            // Consumer errors should not break routing
          }
        }
      }
    }
  }

  return { addConsumer, addGlobalConsumer, route };
}

// ---------------------------------------------------------------------------
// Live Select Manager (Side-Effect Shell)
// ---------------------------------------------------------------------------

export type LiveSelectManagerDeps = {
  surreal: Surreal;
  logger?: LiveSelectLogger;
};

export type LiveSelectManager = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  onEvent: (workspaceId: string, consumer: EventConsumer) => () => void;
  onAnyEvent: (consumer: EventConsumer) => () => void;
  /** Number of active subscriptions after start(). */
  subscriptionCount: () => number;
};

const defaultLogger: LiveSelectLogger = {
  info: (message: string) => console.log(`[LiveSelectManager] ${message}`),
  warn: (message: string) => console.warn(`[LiveSelectManager] ${message}`),
  error: (message: string) => console.error(`[LiveSelectManager] ${message}`),
};

/**
 * Creates a Live Select Manager that subscribes to governance tables
 * via LIVE SELECT on the existing surreal WebSocket connection.
 *
 * Dependency injection: surreal connection and logger passed as parameters.
 */
export function createLiveSelectManager(deps: LiveSelectManagerDeps): LiveSelectManager {
  const { surreal } = deps;
  const logger = deps.logger ?? defaultLogger;
  const router = createEventRouter();
  const subscriptions: LiveSubscription[] = [];
  const unsubscribeFns: Array<() => void> = [];

  async function subscribeToTable(
    tableName: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<boolean> {
    try {
      const subscription = await surreal.live<Record<string, unknown>>(
        new Table(tableName),
      );

      subscriptions.push(subscription);

      const unsubscribe = subscription.subscribe((message) => {
        // KILLED action means the subscription was terminated
        if (message.action === "KILLED") {
          logger.warn(`LIVE SELECT subscription killed for table: ${tableName}`);
          return;
        }

        const event: LiveSelectEvent = {
          table: tableName,
          action: message.action,
          recordId: extractRecordIdString(message.recordId),
          value: message.value ?? {},
        };

        router.route(event);
      });

      unsubscribeFns.push(unsubscribe);

      logger.info(`LIVE SELECT subscribed to table: ${tableName}`);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        logger.warn(
          `Failed to subscribe to table ${tableName} (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delayMs}ms: ${errorMsg}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return subscribeToTable(tableName, attempt + 1, maxAttempts);
      }
      logger.warn(
        `Failed to subscribe to table ${tableName} after ${maxAttempts} attempts: ${errorMsg}. Events for this table will be lost.`,
      );
      return false;
    }
  }

  async function start(): Promise<void> {
    const maxAttempts = 3;
    for (const tableName of GOVERNANCE_TABLES) {
      await subscribeToTable(tableName, 0, maxAttempts);
    }

    logger.info(
      `Live Select Manager started with ${subscriptions.length}/${GOVERNANCE_TABLES.length} subscriptions`,
    );
  }

  async function stop(): Promise<void> {
    // Unsubscribe from message handlers
    for (const unsubscribe of unsubscribeFns) {
      try {
        unsubscribe();
      } catch {
        // Best-effort cleanup
      }
    }
    unsubscribeFns.length = 0;

    // Kill LIVE SELECT subscriptions
    for (const subscription of subscriptions) {
      try {
        await subscription.kill();
      } catch {
        // Best-effort cleanup -- subscription may already be dead
      }
    }
    subscriptions.length = 0;

    logger.info(`Live Select Manager stopped -- all subscriptions killed`);
  }

  function onEvent(workspaceId: string, consumer: EventConsumer): () => void {
    return router.addConsumer(workspaceId, consumer);
  }

  function onAnyEvent(consumer: EventConsumer): () => void {
    return router.addGlobalConsumer(consumer);
  }

  function subscriptionCount(): number {
    return subscriptions.length;
  }

  return { start, stop, onEvent, onAnyEvent, subscriptionCount };
}
