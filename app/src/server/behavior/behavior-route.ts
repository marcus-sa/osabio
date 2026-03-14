/**
 * Behavior HTTP Route Handlers
 *
 * Thin composition layer: parses HTTP requests, delegates to query functions,
 * returns JSON responses. No domain logic lives here.
 */
import { logError } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import {
  listWorkspaceBehaviors,
  listBehaviors,
  type BehaviorRow,
} from "./queries";

// ---------------------------------------------------------------------------
// Response serialization (pure)
// ---------------------------------------------------------------------------

function serializeBehavior(record: BehaviorRow) {
  return {
    id: record.id.id as string,
    metric_type: record.metric_type,
    score: record.score,
    source_telemetry: record.source_telemetry,
    workspace_id: record.workspace.id as string,
    ...(record.session ? { session_id: record.session.id as string } : {}),
    created_at: record.created_at,
  };
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createBehaviorRouteHandlers(deps: ServerDependencies) {
  return {
    handleList: (workspaceId: string, request: Request) =>
      handleListBehaviors(deps, workspaceId, request),
  };
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/behaviors
// ---------------------------------------------------------------------------

async function handleListBehaviors(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const metricType = url.searchParams.get("metric_type") ?? undefined;
    const identityId = url.searchParams.get("identity_id") ?? undefined;

    let records: BehaviorRow[];

    if (identityId) {
      // Query by identity traversing exhibits edges
      records = await listBehaviors(deps.surreal, identityId, metricType);
      // Filter to workspace scope
      records = records.filter((r) => (r.workspace.id as string) === workspaceId);
    } else {
      // Query by workspace directly
      records = await listWorkspaceBehaviors(deps.surreal, workspaceId, metricType);
    }

    return jsonResponse({
      behaviors: records.map(serializeBehavior),
    }, 200);
  } catch (error) {
    logError("behavior.list.failed", "Failed to list behaviors", error, { workspaceId });
    return jsonError("failed to list behaviors", 500);
  }
}
