/**
 * Feed SSE Bridge
 *
 * Transforms graph events from the Live Select Manager into GovernanceFeedItem-
 * shaped SSE events, assigns governance tiers via simple rules, batches within
 * a configurable window (default 500ms), and pushes via the SSE Registry.
 *
 * Pure core: transformToFeedItem, assignTier, classifyTierTransition are pure.
 * Effects at boundary: createFeedSseBridge wires IO (onEvent, emitWorkspaceEvent).
 *
 * Step: 01-04 (Graph-Reactive Coordination)
 */
import { RecordId } from "surrealdb";
import type { GovernanceTier } from "../../shared/contracts";
import type { LiveSelectEvent } from "./live-select-manager";
import type { WorkspaceStreamEvent, SseRegistry } from "../streaming/sse-registry";
import type { LiveSelectManager } from "./live-select-manager";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** A feed item produced by the bridge, matching the WorkspaceStreamEvent item shape. */
export type FeedBridgeItem = {
  id: string;
  tier: GovernanceTier;
  entityId: string;
  entityKind: string;
  entityName: string;
  reason: string;
  status: string;
  severity?: string;
  createdAt: string;
};

type TierTransitionResult = {
  previousTier: GovernanceTier;
  newTier: GovernanceTier;
  isTransition: boolean;
};

// ---------------------------------------------------------------------------
// Pure Functions: Transform
// ---------------------------------------------------------------------------

/**
 * Extracts the display name from a LiveSelectEvent value based on the table.
 * Each entity type stores its name in a different field.
 */
function extractEntityName(table: string, value: Record<string, unknown>): string {
  switch (table) {
    case "decision":
      return (value.summary as string) ?? "Unnamed decision";
    case "task":
      return (value.title as string) ?? "Unnamed task";
    case "observation":
      return (value.text as string) ?? "Unnamed observation";
    case "question":
      return (value.text as string) ?? "Unnamed question";
    case "suggestion":
      return (value.text as string) ?? "Unnamed suggestion";
    case "learning":
      return (value.text as string) ?? "Unnamed learning";
    case "agent_session":
      return (value.task_title as string) ?? `Agent session`;
    default:
      return `Unknown ${table}`;
  }
}

/**
 * Builds the human-readable reason string for a feed item.
 */
function buildReason(table: string, status: string, severity?: string): string {
  switch (table) {
    case "decision":
      if (["provisional", "proposed", "extracted"].includes(status)) {
        return `${capitalize(status)} decision awaiting confirmation`;
      }
      return `Decision ${status}`;
    case "task":
      if (status === "blocked") return "Task is blocked";
      if (status === "done" || status === "completed") return `Recently completed task`;
      return `Task ${status}`;
    case "observation":
      return `${capitalize(severity ?? "info")} observation`;
    case "question":
      return `Open question`;
    case "suggestion":
      return `Pending suggestion`;
    case "learning":
      if (status === "pending_approval") return `Pending learning awaiting approval`;
      return `Learning ${status}`;
    case "agent_session":
      return `Agent session ${status}`;
    default:
      return `${table} ${status}`;
  }
}

/**
 * Transforms a LiveSelectEvent into a FeedBridgeItem.
 * Returns undefined for DELETE events (handled as removals separately).
 */
export function transformToFeedItem(event: LiveSelectEvent): FeedBridgeItem | undefined {
  if (event.action === "DELETE") return undefined;

  const { table, recordId, value } = event;
  const status = (value.status as string) ?? "unknown";
  const severity = value.severity as string | undefined;
  const entityName = extractEntityName(table, value);
  const tier = assignTier(table, status, severity);
  const createdAt = toIsoSafe(value.created_at) ?? new Date().toISOString();

  return {
    id: buildFeedItemId(recordId),
    tier,
    entityId: recordId,
    entityKind: table,
    entityName,
    reason: buildReason(table, status, severity),
    status,
    ...(severity ? { severity } : {}),
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Pure Functions: Tier Assignment
// ---------------------------------------------------------------------------

/**
 * Assigns a governance tier based on entity type, status, and severity.
 *
 * Rules:
 * - blocking: provisional/proposed/extracted decisions, open questions
 * - review: warning/conflict observations (open/acknowledged), blocked tasks,
 *           pending learnings, pending suggestions
 * - awareness: everything else
 */
export function assignTier(
  table: string,
  status: string,
  severity: string | undefined,
): GovernanceTier {
  // Blocking tier
  if (table === "decision" && ["provisional", "proposed", "extracted"].includes(status)) {
    return "blocking";
  }
  if (table === "question" && status === "open") {
    return "blocking";
  }

  // Review tier
  if (table === "observation" && ["open", "acknowledged"].includes(status)) {
    if (severity === "warning" || severity === "conflict") {
      return "review";
    }
  }
  if (table === "task" && status === "blocked") {
    return "review";
  }
  if (table === "learning" && status === "pending_approval") {
    return "review";
  }
  if (table === "suggestion" && status === "pending") {
    return "review";
  }

  // Everything else
  return "awareness";
}

// ---------------------------------------------------------------------------
// Pure Functions: Tier Transition Detection
// ---------------------------------------------------------------------------

/**
 * Classifies whether a status change causes a tier transition.
 * Used to generate removal IDs for items that moved between tiers.
 */
export function classifyTierTransition(
  table: string,
  previousStatus: string,
  newStatus: string,
): TierTransitionResult {
  const previousTier = assignTier(table, previousStatus, undefined);
  const newTier = assignTier(table, newStatus, undefined);

  return {
    previousTier,
    newTier,
    isTransition: previousTier !== newTier,
  };
}

// ---------------------------------------------------------------------------
// Pure Functions: Event ID Counter
// ---------------------------------------------------------------------------

/**
 * Creates a monotonically increasing event ID counter for SSE reconnection
 * delta sync support.
 */
export function createEventIdCounter(startFrom: number = 0): () => number {
  let counter = startFrom;
  return () => ++counter;
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

type BatcherConfig = {
  windowMs: number;
  onFlush: (items: FeedBridgeItem[], removals: string[]) => void;
};

type Batcher = {
  add: (item: FeedBridgeItem, removalId?: string) => void;
  dispose: () => void;
};

/**
 * Creates a batcher that collects feed items within a time window
 * and flushes them as a single batch when the window expires.
 *
 * This prevents client flooding when many graph changes happen
 * in rapid succession (e.g., bulk extraction).
 */
export function createBatcher(config: BatcherConfig): Batcher {
  let pendingItems: FeedBridgeItem[] = [];
  let pendingRemovals: string[] = [];
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function flush(): void {
    if (disposed) return;
    if (pendingItems.length === 0 && pendingRemovals.length === 0) return;

    const items = pendingItems;
    const removals = pendingRemovals;
    pendingItems = [];
    pendingRemovals = [];
    timerId = undefined;

    config.onFlush(items, removals);
  }

  function add(item: FeedBridgeItem, removalId?: string): void {
    if (disposed) return;

    pendingItems.push(item);
    if (removalId) {
      pendingRemovals.push(removalId);
    }

    if (timerId === undefined) {
      timerId = setTimeout(flush, config.windowMs);
    }
  }

  function dispose(): void {
    disposed = true;
    if (timerId !== undefined) {
      clearTimeout(timerId);
      timerId = undefined;
    }
    pendingItems = [];
    pendingRemovals = [];
  }

  return { add, dispose };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function buildFeedItemId(recordId: string): string {
  return recordId;
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toIsoSafe(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    try {
      return new Date(value).toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Bridge Wiring (Side-Effect Shell)
// ---------------------------------------------------------------------------

export type FeedSseBridgeDeps = {
  liveSelectManager: LiveSelectManager;
  sseRegistry: SseRegistry;
  batchWindowMs?: number;
};

export type FeedSseBridge = {
  /** Start listening for events on the given workspace. Returns unsubscribe function. */
  subscribe: (workspaceId: string) => () => void;
  /** Subscribe to all workspaces (global consumer). Returns unsubscribe function. */
  subscribeAll: () => () => void;
};

/**
 * Creates the Feed SSE Bridge that connects the Live Select Manager
 * to the SSE Registry, transforming graph events into feed updates.
 *
 * Dependency injection: all IO passed as function parameters.
 */
export function createFeedSseBridge(deps: FeedSseBridgeDeps): FeedSseBridge {
  const { liveSelectManager, sseRegistry } = deps;
  const batchWindowMs = deps.batchWindowMs ?? 500;
  const batchers = new Map<string, Batcher>();

  function getOrCreateBatcher(workspaceId: string): Batcher {
    let batcher = batchers.get(workspaceId);
    if (!batcher) {
      batcher = createBatcher({
        windowMs: batchWindowMs,
        onFlush: (items, removals) => {
          const event: WorkspaceStreamEvent = {
            items: items.map((item) => ({
              id: item.id,
              type: item.entityKind,
              tier: item.tier,
              title: item.entityName,
              ...(item.severity ? { severity: item.severity } : {}),
              created_at: item.createdAt,
            })),
            ...(removals.length > 0 ? { removals } : {}),
          };
          sseRegistry.emitWorkspaceEvent(workspaceId, event);
        },
      });
      batchers.set(workspaceId, batcher);
    }
    return batcher;
  }

  function handleEvent(workspaceId: string, event: LiveSelectEvent): void {
    // For DELETE events, emit removal only
    if (event.action === "DELETE") {
      const batcher = getOrCreateBatcher(workspaceId);
      // Create a minimal item for the removal notification
      batcher.add(
        {
          id: event.recordId,
          tier: "awareness",
          entityId: event.recordId,
          entityKind: event.table,
          entityName: "",
          reason: "Deleted",
          status: "deleted",
          createdAt: new Date().toISOString(),
        },
        event.recordId,
      );
      return;
    }

    const item = transformToFeedItem(event);
    if (!item) return;

    const batcher = getOrCreateBatcher(workspaceId);

    // On UPDATE, detect tier transitions and emit removal by entity ID
    // so the client replaces the old tier item instead of accumulating duplicates
    if (event.action === "UPDATE") {
      const previousStatus = (event.value._previous_status as string) ?? undefined;
      if (previousStatus) {
        const transition = classifyTierTransition(event.table, previousStatus, item.status);
        if (transition.isTransition) {
          batcher.add(item, item.entityId);
          return;
        }
      }
    }

    batcher.add(item);
  }

  function subscribe(workspaceId: string): () => void {
    const unsubscribe = liveSelectManager.onEvent(workspaceId, (event) => {
      handleEvent(workspaceId, event);
    });

    return () => {
      unsubscribe();
      const batcher = batchers.get(workspaceId);
      if (batcher) {
        batcher.dispose();
        batchers.delete(workspaceId);
      }
    };
  }

  function subscribeAll(): () => void {
    const unsubscribe = liveSelectManager.onAnyEvent((event) => {
      // Extract workspace ID from the event value
      const workspaceId = extractWorkspaceId(event.value);
      if (workspaceId) {
        handleEvent(workspaceId, event);
      }
    });

    return () => {
      unsubscribe();
      for (const batcher of batchers.values()) {
        batcher.dispose();
      }
      batchers.clear();
    };
  }

  return { subscribe, subscribeAll };
}

// ---------------------------------------------------------------------------
// Workspace ID Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the workspace ID string from a LiveSelectEvent value.
 * The workspace field can be a RecordId or a string like "workspace:ws-123".
 */
function extractWorkspaceId(value: Record<string, unknown>): string | undefined {
  const workspace = value.workspace;
  if (!workspace) return undefined;

  if (workspace instanceof RecordId) {
    return workspace.id as string;
  }

  if (typeof workspace === "string") {
    const parts = workspace.split(":");
    if (parts.length >= 2) {
      return parts.slice(1).join(":");
    }
  }

  return undefined;
}
