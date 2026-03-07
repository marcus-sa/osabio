import { RecordId } from "surrealdb";
import type { EntityKind, SearchEntityResponse } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { elapsedMs, logDebug, logError, logInfo, logWarn } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceProjectRecord, resolveWorkspaceRecord } from "../workspace/workspace-scope";

type SearchEntityRow = {
  id: RecordId<string, string>;
  kind: EntityKind;
  text: string;
  score: number;
};

// BM25 full-text search queries per entity type.
// Queries run from app layer because:
// 1. search::score() / @N@ don't work inside DEFINE FUNCTION (https://github.com/surrealdb/surrealdb/issues/7013)
// 2. @N@ doesn't work with SDK bound parameters — search term must be a string literal

function escapeSearchQuery(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildWorkspaceSearchSQL(escapedQuery: string): string {
  const q = `'${escapedQuery}'`;
  return `
SELECT id, "task" AS kind, title AS text, search::score(1) AS score
FROM task WHERE title @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "decision" AS kind, summary AS text, search::score(1) AS score
FROM decision WHERE summary @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "question" AS kind, text AS text, search::score(1) AS score
FROM question WHERE text @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "observation" AS kind, text AS text, search::score(1) AS score
FROM observation WHERE text @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "suggestion" AS kind, text AS text, search::score(1) AS score
FROM suggestion WHERE text @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "feature" AS kind, name AS text, search::score(1) AS score
FROM feature WHERE name @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "project" AS kind, name AS text, search::score(1) AS score
FROM project WHERE name @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "person" AS kind, name AS text, search::score(1) AS score
FROM person WHERE name @1@ ${q} ORDER BY score DESC LIMIT $limit;

SELECT id, "message" AS kind, text AS text, search::score(1) AS score
FROM message WHERE text @1@ ${q} AND conversation.workspace = $workspace ORDER BY score DESC LIMIT $limit;
`;
}

function buildProjectSearchSQL(escapedQuery: string): string {
  const q = `'${escapedQuery}'`;
  return `
LET $project_entity_ids = SELECT VALUE in FROM belongs_to WHERE out = $project;

SELECT id, "task" AS kind, title AS text, search::score(1) AS score
FROM task WHERE title @1@ ${q} AND workspace = $workspace AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "decision" AS kind, summary AS text, search::score(1) AS score
FROM decision WHERE summary @1@ ${q} AND workspace = $workspace AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "question" AS kind, text AS text, search::score(1) AS score
FROM question WHERE text @1@ ${q} AND workspace = $workspace AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "observation" AS kind, text AS text, search::score(1) AS score
FROM observation WHERE text @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "suggestion" AS kind, text AS text, search::score(1) AS score
FROM suggestion WHERE text @1@ ${q} AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "feature" AS kind, name AS text, search::score(1) AS score
FROM feature WHERE name @1@ ${q} AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "message" AS kind, text AS text, search::score(1) AS score
FROM message WHERE text @1@ ${q} AND conversation.workspace = $workspace ORDER BY score DESC LIMIT $limit;
`;
}

export function createEntitySearchHandler(deps: ServerDependencies): (url: URL) => Promise<Response> {
  return (url: URL) => handleEntitySearch(deps, url);
}

async function handleEntitySearch(deps: ServerDependencies, url: URL): Promise<Response> {
  const startedAt = performance.now();
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return jsonError("workspaceId is required", 400);
  }

  const projectId = url.searchParams.get("projectId")?.trim();

  const query = url.searchParams.get("q")?.trim();
  if (!query) {
    return jsonError("q is required", 400);
  }

  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = Number(rawLimit ?? "10");
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return jsonError("limit must be a positive number", 400);
  }

  const limit = Math.min(Math.floor(parsedLimit), 100);
  logDebug("http.request.validated", "Entity search request validated", {
    workspaceId,
    projectId,
    limit,
    queryLength: query.length,
  });
  logInfo("entity.search.started", "Entity search started", {
    workspaceId,
    projectId,
    limit,
  });

  let workspaceRecord: RecordId<"workspace", string>;
  let projectRecord: RecordId<"project", string> | undefined;

  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    if (projectId) {
      projectRecord = await resolveWorkspaceProjectRecord(deps.surreal, workspaceRecord, projectId);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      logWarn("entity.search.http_error", "Entity search failed with client-facing error", {
        workspaceId,
        projectId,
        statusCode: error.status,
      });
      return jsonError(error.message, error.status);
    }

    logError("entity.search.scope_validation.failed", "Entity search scope validation failed", error, {
      workspaceId,
      projectId,
    });
    const errorText = error instanceof Error ? error.message : "failed to validate scope";
    return jsonError(errorText, 500);
  }

  const escaped = escapeSearchQuery(query);
  const sql = projectRecord
    ? buildProjectSearchSQL(escaped)
    : buildWorkspaceSearchSQL(escaped);

  const bindings = {
    limit,
    workspace: workspaceRecord,
    ...(projectRecord ? { project: projectRecord } : {}),
  };

  const results = await deps.surreal.query(sql, bindings);

  const allRows = (results as unknown as SearchEntityRow[][])
    .filter(Array.isArray)
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const responseRows = allRows.map((row) => ({
    id: row.id.id as string,
    kind: row.kind,
    text: row.text,
    confidence: row.score,
    sourceId: "",
    sourceKind: "message",
  } satisfies SearchEntityResponse));

  logInfo("entity.search.completed", "Entity search completed", {
    workspaceId,
    projectId,
    limit,
    resultCount: responseRows.length,
    durationMs: elapsedMs(startedAt),
  });

  return jsonResponse(responseRows, 200);
}
