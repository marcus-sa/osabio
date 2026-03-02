import type { RecordId } from "surrealdb";
import type {
  EntityCategory,
  EntityKind,
  EntityPriority,
  GovernanceFeedAction,
  GovernanceFeedItem,
  GovernanceFeedResponse,
  ObservationSeverity,
} from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { elapsedMs, logError, logInfo, logWarn } from "../http/observability";
import { jsonError, jsonResponse, toIsoString } from "../http/response";
import { listWorkspaceOpenObservations } from "../observation/queries";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  listBlockedTasks,
  listBlockingQuestions,
  listLowConfidenceDecisions,
  listProvisionalDecisions,
  listRecentExtractions,
  listRecentlyCompletedItems,
  listStaleTasks,
  listWorkspaceConflicts,
} from "./feed-queries";

const LOW_CONFIDENCE_THRESHOLD = 0.7;
const STALE_DAYS = 7;
const RECENT_COMPLETED_DAYS = 7;
const FEED_ITEM_LIMIT = 20;

export function createFeedRouteHandler(
  deps: ServerDependencies,
): (workspaceId: string) => Promise<Response> {
  return (workspaceId: string) => handleFeed(deps, workspaceId);
}

async function handleFeed(deps: ServerDependencies, workspaceId: string): Promise<Response> {
  const startedAt = performance.now();
  logInfo("feed.started", "Governance feed request started", { workspaceId });

  let workspaceRecord: RecordId<"workspace", string>;
  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("feed.workspace_resolve.http_error", "Feed workspace resolve failed", {
        workspaceId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }
    logError("feed.workspace_resolve.failed", "Feed workspace resolve failed", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }

  try {
    const queryInput = { surreal: deps.surreal, workspaceRecord, limit: FEED_ITEM_LIMIT };

    const [
      provisionalDecisions,
      conflicts,
      blockingQuestions,
      lowConfidenceDecisions,
      blockedTasks,
      observations,
      staleTasks,
      recentlyCompleted,
      recentExtractions,
    ] = await Promise.all([
      listProvisionalDecisions(queryInput),
      listWorkspaceConflicts(queryInput),
      listBlockingQuestions(queryInput),
      listLowConfidenceDecisions({ ...queryInput, confidenceThreshold: LOW_CONFIDENCE_THRESHOLD }),
      listBlockedTasks(queryInput),
      listWorkspaceOpenObservations({ surreal: deps.surreal, workspaceRecord, limit: FEED_ITEM_LIMIT }),
      listStaleTasks({ ...queryInput, staleDays: STALE_DAYS }),
      listRecentlyCompletedItems({ ...queryInput, recentDays: RECENT_COMPLETED_DAYS }),
      listRecentExtractions(queryInput),
    ]);

    const blocking: GovernanceFeedItem[] = [];
    const review: GovernanceFeedItem[] = [];
    const awareness: GovernanceFeedItem[] = [];

    // Blocking: provisional decisions
    for (const row of provisionalDecisions) {
      const entityId = row.id.id as string;
      blocking.push({
        id: `decision:${entityId}:${row.status}`,
        tier: "blocking",
        entityId,
        entityKind: "decision",
        entityName: row.summary,
        reason: `${capitalize(row.status)} decision awaiting confirmation`,
        status: row.status,
        ...(row.project ? { project: row.project } : {}),
        ...(row.category ? { category: row.category as EntityCategory } : {}),
        ...(row.priority ? { priority: row.priority as EntityPriority } : {}),
        createdAt: toIsoString(row.created_at),
        actions: decisionActions(),
      });
    }

    // Blocking: conflicts
    for (const row of conflicts) {
      blocking.push({
        id: `conflict:${row.edgeId}`,
        tier: "blocking",
        entityId: row.fromRecord.id as string,
        entityKind: row.fromKind as EntityKind,
        entityName: row.fromName,
        reason: row.description ?? `Conflicts with ${row.toName}`,
        status: "conflict",
        ...(row.severity ? { severity: row.severity as ObservationSeverity } : {}),
        createdAt: row.detectedAt,
        actions: conflictActions(),
        conflictTarget: {
          entityId: row.toRecord.id as string,
          entityKind: row.toKind as EntityKind,
          entityName: row.toName,
        },
      });
    }

    // Blocking: high/critical questions
    for (const row of blockingQuestions) {
      const entityId = row.id.id as string;
      blocking.push({
        id: `question:${entityId}:blocking`,
        tier: "blocking",
        entityId,
        entityKind: "question",
        entityName: row.text,
        reason: `${capitalize(row.priority)} priority open question`,
        status: row.status,
        ...(row.project ? { project: row.project } : {}),
        ...(row.category ? { category: row.category as EntityCategory } : {}),
        priority: row.priority as EntityPriority,
        createdAt: toIsoString(row.created_at),
        actions: questionActions(),
      });
    }

    // Review: low confidence decisions
    for (const row of lowConfidenceDecisions) {
      const entityId = row.id.id as string;
      review.push({
        id: `decision:${entityId}:low_confidence`,
        tier: "review",
        entityId,
        entityKind: "decision",
        entityName: row.summary,
        reason: `Low confidence inferred decision (${Math.round(row.extraction_confidence * 100)}%)`,
        status: row.status,
        ...(row.project ? { project: row.project } : {}),
        ...(row.category ? { category: row.category as EntityCategory } : {}),
        ...(row.priority ? { priority: row.priority as EntityPriority } : {}),
        createdAt: toIsoString(row.created_at),
        actions: decisionActions(),
      });
    }

    // Review: blocked tasks
    for (const row of blockedTasks) {
      const entityId = row.id.id as string;
      review.push({
        id: `task:${entityId}:blocked`,
        tier: "review",
        entityId,
        entityKind: "task",
        entityName: row.title,
        reason: "Task is blocked",
        status: row.status,
        ...(row.project ? { project: row.project } : {}),
        ...(row.category ? { category: row.category as EntityCategory } : {}),
        ...(row.priority ? { priority: row.priority as EntityPriority } : {}),
        createdAt: toIsoString(row.created_at),
        actions: blockedTaskActions(),
      });
    }

    // Review + Awareness: observations (warning = review, info = awareness)
    for (const obs of observations) {
      const tier = obs.severity === "info" ? "awareness" : "review";
      const item: GovernanceFeedItem = {
        id: `observation:${obs.id}:${obs.severity}`,
        tier,
        entityId: obs.id,
        entityKind: "observation",
        entityName: obs.text,
        reason: `${capitalize(obs.severity)} observation from ${obs.sourceAgent}`,
        status: obs.status,
        ...(obs.category ? { category: obs.category } : {}),
        severity: obs.severity,
        createdAt: obs.createdAt,
        actions: observationActions(obs.status),
      };

      if (tier === "review") {
        review.push(item);
      } else {
        awareness.push(item);
      }
    }

    // Awareness: stale tasks
    for (const row of staleTasks) {
      const entityId = row.id.id as string;
      awareness.push({
        id: `task:${entityId}:stale`,
        tier: "awareness",
        entityId,
        entityKind: "task",
        entityName: row.title,
        reason: `Task open for over ${STALE_DAYS} days`,
        status: row.status,
        ...(row.project ? { project: row.project } : {}),
        ...(row.category ? { category: row.category as EntityCategory } : {}),
        ...(row.priority ? { priority: row.priority as EntityPriority } : {}),
        createdAt: toIsoString(row.created_at),
        actions: staleTaskActions(),
      });
    }

    // Awareness: recently completed
    for (const row of recentlyCompleted) {
      const entityId = row.id.id as string;
      awareness.push({
        id: `${row.kind}:${entityId}:completed`,
        tier: "awareness",
        entityId,
        entityKind: row.kind as EntityKind,
        entityName: row.name,
        reason: `Recently completed ${row.kind}`,
        status: row.status,
        ...(row.project ? { project: row.project } : {}),
        ...(row.category ? { category: row.category as EntityCategory } : {}),
        createdAt: toIsoString(row.updated_at),
        actions: [],
      });
    }

    // Awareness: recent extractions
    for (const row of recentExtractions) {
      awareness.push({
        id: `extraction:${row.edgeId}`,
        tier: "awareness",
        entityId: row.entityId,
        entityKind: row.entityKind as EntityKind,
        entityName: row.entityName,
        reason: `Extracted from ${row.sourceKind.replace("_", " ")}`,
        status: "extracted",
        createdAt: row.extractedAt,
        actions: [],
      });
    }

    const payload: GovernanceFeedResponse = {
      blocking,
      review,
      awareness,
      updatedAt: new Date().toISOString(),
    };

    logInfo("feed.completed", "Governance feed request completed", {
      workspaceId,
      blockingCount: blocking.length,
      reviewCount: review.length,
      awarenessCount: awareness.length,
      durationMs: elapsedMs(startedAt),
    });

    return jsonResponse(payload, 200);
  } catch (error) {
    logError("feed.failed", "Governance feed request failed", error, { workspaceId });
    const message = error instanceof Error ? error.message : "feed request failed";
    return jsonError(message, 500);
  }
}

// --- Action button builders ---

function decisionActions(): GovernanceFeedAction[] {
  return [
    { action: "confirm", label: "Confirm" },
    { action: "override", label: "Override" },
    { action: "discuss", label: "Discuss" },
  ];
}

function conflictActions(): GovernanceFeedAction[] {
  return [
    { action: "acknowledge", label: "Acknowledge" },
    { action: "resolve", label: "Resolve" },
    { action: "discuss", label: "Discuss" },
  ];
}

function questionActions(): GovernanceFeedAction[] {
  return [
    { action: "resolve", label: "Resolve" },
    { action: "discuss", label: "Discuss" },
  ];
}

function observationActions(status: string): GovernanceFeedAction[] {
  if (status === "acknowledged") {
    return [
      { action: "resolve", label: "Resolve" },
    ];
  }
  return [
    { action: "acknowledge", label: "Acknowledge" },
    { action: "resolve", label: "Resolve" },
  ];
}

function blockedTaskActions(): GovernanceFeedAction[] {
  return [
    { action: "complete", label: "Complete" },
    { action: "discuss", label: "Discuss" },
  ];
}

function staleTaskActions(): GovernanceFeedAction[] {
  return [
    { action: "complete", label: "Complete" },
    { action: "discuss", label: "Discuss" },
  ];
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
