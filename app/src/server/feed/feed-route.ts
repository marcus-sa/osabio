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
import { listWorkspacePendingSuggestions } from "../suggestion/queries";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  listAgentAttentionSessions,
  listBlockedTasks,
  listBlockingQuestions,
  listLowConfidenceDecisions,
  listPendingVetoIntents,
  listProvisionalDecisions,
  listRecentExtractions,
  listRecentlyCompletedItems,
  listStaleTasks,
  listWorkspaceConflicts,
  mapAgentSessionToFeedItem,
  mapPendingIntentToFeedItem,
} from "./feed-queries";

const LOW_CONFIDENCE_THRESHOLD = 0.7;
const STALE_DAYS = 7;
const RECENT_COMPLETED_DAYS = 3;
const AWARENESS_RECENCY_DAYS = 3;
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
      suggestions,
      staleTasks,
      recentlyCompleted,
      recentExtractions,
      agentAttentionSessions,
      pendingVetoIntents,
    ] = await Promise.all([
      listProvisionalDecisions(queryInput),
      listWorkspaceConflicts(queryInput),
      listBlockingQuestions(queryInput),
      listLowConfidenceDecisions({ ...queryInput, confidenceThreshold: LOW_CONFIDENCE_THRESHOLD }),
      listBlockedTasks(queryInput),
      listWorkspaceOpenObservations({ surreal: deps.surreal, workspaceRecord, limit: FEED_ITEM_LIMIT }),
      listWorkspacePendingSuggestions({ surreal: deps.surreal, workspaceRecord, limit: FEED_ITEM_LIMIT }),
      listStaleTasks({ ...queryInput, staleDays: STALE_DAYS }),
      listRecentlyCompletedItems({ ...queryInput, recentDays: RECENT_COMPLETED_DAYS }),
      listRecentExtractions({ ...queryInput, cutoff: new Date(Date.now() - AWARENESS_RECENCY_DAYS * 24 * 60 * 60 * 1000) }),
      listAgentAttentionSessions(queryInput),
      listPendingVetoIntents(queryInput),
    ]);

    const blocking: GovernanceFeedItem[] = [];
    const review: GovernanceFeedItem[] = [];
    const awareness: GovernanceFeedItem[] = [];

    // Blocking: provisional decisions
    for (const row of provisionalDecisions) {
      const rawId = row.id.id as string;
      blocking.push({
        id: `decision:${rawId}:${row.status}`,
        tier: "blocking",
        entityId: `decision:${rawId}`,
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
        entityId: `${row.fromKind}:${row.fromRecord.id as string}`,
        entityKind: row.fromKind as EntityKind,
        entityName: row.fromName,
        reason: row.description ?? `Conflicts with ${row.toName}`,
        status: "conflict",
        ...(row.severity ? { severity: row.severity as ObservationSeverity } : {}),
        createdAt: row.detectedAt,
        actions: conflictActions(),
        conflictTarget: {
          entityId: `${row.toKind}:${row.toRecord.id as string}`,
          entityKind: row.toKind as EntityKind,
          entityName: row.toName,
        },
      });
    }

    // Blocking: high/critical questions
    for (const row of blockingQuestions) {
      const rawId = row.id.id as string;
      blocking.push({
        id: `question:${rawId}:blocking`,
        tier: "blocking",
        entityId: `question:${rawId}`,
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

    // Blocking + Review: agent attention sessions (error -> blocking, idle -> review)
    for (const session of agentAttentionSessions) {
      const item = mapAgentSessionToFeedItem(session);
      if (item.tier === "blocking") {
        blocking.push(item);
      } else {
        review.push(item);
      }
    }

    // Blocking: pending veto intents (agent actions awaiting human review)
    for (const intent of pendingVetoIntents) {
      blocking.push(mapPendingIntentToFeedItem(intent));
    }

    // Review: low confidence decisions
    for (const row of lowConfidenceDecisions) {
      const rawId = row.id.id as string;
      review.push({
        id: `decision:${rawId}:low_confidence`,
        tier: "review",
        entityId: `decision:${rawId}`,
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
      const rawId = row.id.id as string;
      review.push({
        id: `task:${rawId}:blocked`,
        tier: "review",
        entityId: `task:${rawId}`,
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

    // Review: all open/acknowledged observations need human action
    for (const obs of observations) {
      review.push({
        id: `observation:${obs.id}:${obs.severity}`,
        tier: "review",
        entityId: `observation:${obs.id}`,
        entityKind: "observation",
        entityName: obs.text,
        reason: `${capitalize(obs.severity)} observation from ${obs.sourceAgent}`,
        status: obs.status,
        ...(obs.category ? { category: obs.category } : {}),
        severity: obs.severity,
        createdAt: obs.createdAt,
        actions: observationActions(obs.status),
      });
    }

    // Review: pending suggestions from agents
    for (const sug of suggestions) {
      review.push({
        id: `suggestion:${sug.id}:${sug.category}`,
        tier: "review",
        entityId: `suggestion:${sug.id}`,
        entityKind: "suggestion",
        entityName: sug.text,
        reason: `${capitalize(sug.category)} suggestion from ${sug.suggestedBy} (confidence ${Math.round(sug.confidence * 100)}%)`,
        status: sug.status,
        createdAt: sug.createdAt,
        actions: suggestionActions(),
      });
    }

    // Awareness items are filtered to the last AWARENESS_RECENCY_DAYS
    const awarenessCutoff = new Date(Date.now() - AWARENESS_RECENCY_DAYS * 24 * 60 * 60 * 1000);

    // Awareness: stale tasks (only if they crossed the stale threshold recently)
    for (const row of staleTasks) {
      const ts = row.updated_at ? new Date(row.updated_at) : new Date(row.created_at);
      if (ts < awarenessCutoff) continue;
      const rawId = row.id.id as string;
      awareness.push({
        id: `task:${rawId}:stale`,
        tier: "awareness",
        entityId: `task:${rawId}`,
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

    // Awareness: recently completed (already filtered by RECENT_COMPLETED_DAYS query)
    for (const row of recentlyCompleted) {
      const rawId = row.id.id as string;
      awareness.push({
        id: `${row.kind}:${rawId}:completed`,
        tier: "awareness",
        entityId: `${row.kind}:${rawId}`,
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

    // Awareness: recent extractions (skip entities already in higher tiers)
    const seenEntityIds = new Set<string>();
    for (const item of [...blocking, ...review, ...awareness]) {
      seenEntityIds.add(item.entityId);
    }
    for (const row of recentExtractions) {
      const entityId = `${row.entityKind}:${row.entityId}`;
      if (seenEntityIds.has(entityId)) continue;
      awareness.push({
        id: `extraction:${row.edgeId}`,
        tier: "awareness",
        entityId,
        entityKind: row.entityKind as EntityKind,
        entityName: row.entityName,
        reason: `Extracted from ${row.sourceKind.replace("_", " ")}`,
        status: "extracted",
        createdAt: row.extractedAt,
        actions: row.entityKind === "question" ? questionActions() : [],
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
    { action: "discuss", label: "Answer" },
    { action: "dismiss", label: "Dismiss" },
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

function suggestionActions(): GovernanceFeedAction[] {
  return [
    { action: "accept", label: "Accept" },
    { action: "defer", label: "Defer" },
    { action: "dismiss", label: "Dismiss" },
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
