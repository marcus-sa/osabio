import { RecordId, type Surreal } from "surrealdb";
import { HttpError } from "../http/errors";
import { logError, logInfo } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  getEntityDetail,
  parseRecordIdString,
  type GraphEntityTable,
} from "../graph/queries";
import { buildEntityDetailResponse, type AgentSessionRow } from "./entity-detail-response";

export function createEntityDetailHandler(
  deps: ServerDependencies,
): (entityId: string, url: URL) => Promise<Response> {
  return (entityId: string, url: URL) => handleEntityDetail(deps, entityId, url);
}

async function handleEntityDetail(
  deps: ServerDependencies,
  entityId: string,
  url: URL,
): Promise<Response> {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return jsonError("workspaceId is required", 400);
  }

  let workspaceRecord;
  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    logError("entity.detail.workspace_resolve.failed", "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }

  try {
    const entityTables: GraphEntityTable[] = ["workspace", "project", "person", "feature", "task", "decision", "question", "suggestion", "objective", "behavior"];
    const entityRecord = parseRecordIdString(entityId, entityTables);
    const detail = await getEntityDetail({
      surreal: deps.surreal,
      workspaceRecord,
      entityRecord,
    });

    const agentSessionRow = detail.entity.kind === "task"
      ? await findActiveAgentSession(deps.surreal, entityRecord)
      : undefined;

    const response = buildEntityDetailResponse(detail, agentSessionRow);

    logInfo("entity.detail.served", "Entity detail served", {
      workspaceId,
      entityId,
      relationshipCount: detail.relationships.length,
      provenanceCount: detail.provenance.length,
      hasAgentSession: !!agentSessionRow,
    });

    return jsonResponse(response, 200);
  } catch (error) {
    logError("entity.detail.failed", "Entity detail failed", error, {
      workspaceId,
      entityId,
    });
    const message = error instanceof Error ? error.message : "entity detail failed";
    return jsonError(message, 500);
  }
}

const ACTIVE_SESSION_STATUSES = ["spawning", "active", "idle"];

type AgentSessionQueryRow = {
  id: RecordId<"agent_session", string>;
  orchestrator_status: string;
  stream_id: string;
  started_at: string | Date;
  files_changed: Array<unknown> | undefined;
};

async function findActiveAgentSession(
  surreal: Surreal,
  taskRecord: RecordId<string, string>,
): Promise<AgentSessionRow | undefined> {
  const [rows] = await surreal
    .query<[AgentSessionQueryRow[]]>(
      [
        "SELECT id, orchestrator_status, stream_id, started_at, files_changed",
        "FROM agent_session",
        "WHERE task_id = $taskRecord",
        "AND orchestrator_status IN $statuses",
        "ORDER BY started_at DESC",
        "LIMIT 1;",
      ].join(" "),
      { taskRecord, statuses: ACTIVE_SESSION_STATUSES },
    )
    .collect<[AgentSessionQueryRow[]]>();

  const row = rows[0];
  if (!row) return undefined;

  const startedAt = row.started_at instanceof Date
    ? row.started_at.toISOString()
    : row.started_at;

  return {
    id: row.id.id as string,
    orchestrator_status: row.orchestrator_status,
    stream_id: row.stream_id ?? "",
    started_at: startedAt,
    files_changed_count: row.files_changed?.length ?? 0,
  };
}
