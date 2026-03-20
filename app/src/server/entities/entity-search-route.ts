import { RecordId } from "surrealdb";
import { trace } from "@opentelemetry/api";
import type { EntityKind, SearchEntityResponse } from "../../shared/contracts";
import { HttpError } from "../http/errors";
import { applyRrf, type RrfItem } from "../graph/bm25-search";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceProjectRecord, resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { log } from "../telemetry/logger";

type SearchEntityRow = {
  id: RecordId<string, string>;
  kind: EntityKind;
  text: string;
  score: number;
};

// BM25 full-text search queries per entity type.
// Queries run from app layer because search::score() / @N@ don't work
// inside DEFINE FUNCTION (https://github.com/surrealdb/surrealdb/issues/7013)

function buildWorkspaceSearchSQL(): string {
  return `
SELECT id, "task" AS kind, title AS text, search::score(1) AS score
FROM task WHERE title @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "decision" AS kind, summary AS text, search::score(1) AS score
FROM decision WHERE summary @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "question" AS kind, text AS text, search::score(1) AS score
FROM question WHERE text @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "observation" AS kind, text AS text, search::score(1) AS score
FROM observation WHERE text @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "suggestion" AS kind, text AS text, search::score(1) AS score
FROM suggestion WHERE text @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "feature" AS kind, name AS text, search::score(1) AS score
FROM feature WHERE name @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "project" AS kind, name AS text, search::score(1) AS score
FROM project WHERE name @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "person" AS kind, name AS text, search::score(1) AS score
FROM person WHERE name @1@ $query ORDER BY score DESC LIMIT $limit;

SELECT id, "message" AS kind, text AS text, search::score(1) AS score
FROM message WHERE text @1@ $query AND conversation.workspace = $workspace ORDER BY score DESC LIMIT $limit;
`;
}

function buildProjectSearchSQL(): string {
  return `
LET $project_entity_ids = SELECT VALUE in FROM belongs_to WHERE out = $project;

SELECT id, "task" AS kind, title AS text, search::score(1) AS score
FROM task WHERE title @1@ $query AND workspace = $workspace AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "decision" AS kind, summary AS text, search::score(1) AS score
FROM decision WHERE summary @1@ $query AND workspace = $workspace AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "question" AS kind, text AS text, search::score(1) AS score
FROM question WHERE text @1@ $query AND workspace = $workspace AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "observation" AS kind, text AS text, search::score(1) AS score
FROM observation WHERE text @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "suggestion" AS kind, text AS text, search::score(1) AS score
FROM suggestion WHERE text @1@ $query AND workspace = $workspace ORDER BY score DESC LIMIT $limit;

SELECT id, "feature" AS kind, name AS text, search::score(1) AS score
FROM feature WHERE name @1@ $query AND id IN $project_entity_ids ORDER BY score DESC LIMIT $limit;

SELECT id, "message" AS kind, text AS text, search::score(1) AS score
FROM message WHERE text @1@ $query AND conversation.workspace = $workspace ORDER BY score DESC LIMIT $limit;
`;
}

export function createEntitySearchHandler(deps: ServerDependencies): (url: URL) => Promise<Response> {
  return (url: URL) => handleEntitySearch(deps, url);
}

async function handleEntitySearch(deps: ServerDependencies, url: URL): Promise<Response> {
  const span = trace.getActiveSpan();
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

  // Wide event: enrich span with search context
  span?.setAttribute("workspace.id", workspaceId);
  span?.setAttribute("search.query_length", query.length);
  span?.setAttribute("search.limit", limit);
  if (projectId) span?.setAttribute("search.project_id", projectId);

  let workspaceRecord: RecordId<"workspace", string>;
  let projectRecord: RecordId<"project", string> | undefined;

  try {
    workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    if (projectId) {
      projectRecord = await resolveWorkspaceProjectRecord(deps.surreal, workspaceRecord, projectId);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error; // withTracing handles HttpError → proper status code + span attributes
    }
    log.error("entity.search.scope_validation.failed", "Entity search scope validation failed", error, {
      workspaceId,
      projectId,
    });
    const errorText = error instanceof Error ? error.message : "failed to validate scope";
    return jsonError(errorText, 500);
  }

  const sql = projectRecord
    ? buildProjectSearchSQL()
    : buildWorkspaceSearchSQL();

  const bindings = {
    limit,
    query,
    workspace: workspaceRecord,
    ...(projectRecord ? { project: projectRecord } : {}),
  };

  const results = await deps.surreal.query(sql, bindings);

  // Group into per-table ranked lists, then apply RRF fusion
  const allArrays = (results as unknown as SearchEntityRow[][]).filter(Array.isArray);
  const rankedLists = allArrays.map((rows) =>
    rows.map((row): RrfItem<SearchEntityRow> => ({
      _rrfKey: `${row.kind}:${row.id.id as string}`,
      id: row.id,
      kind: row.kind,
      text: row.text,
      score: row.score,
    })),
  );

  const fused = applyRrf(rankedLists, limit);

  const responseRows = fused.map((row) => ({
    id: row.id.id as string,
    kind: row.kind,
    text: row.text,
    confidence: row.rrfScore,
    sourceId: "",
    sourceKind: "message",
  } satisfies SearchEntityResponse));

  span?.setAttribute("search.result_count", responseRows.length);
  span?.setAttribute("search.scope", projectRecord ? "project" : "workspace");

  return jsonResponse(responseRows, 200);
}
