/**
 * BM25 fulltext search query builders — pure functions for constructing
 * SurrealDB BM25 search queries.
 *
 * Pattern follows entity-search-route.ts:
 *   1. escapeSearchQuery(query) — escape backslashes and single quotes
 *   2. Interpolate escaped query as string literal in SQL (NOT SDK bound param)
 *   3. Per-table SELECT ... WHERE field @N@ 'escaped_query' AND workspace = $ws
 *   4. search::score(N) returns BM25 relevance score
 *   5. Merge results across tables, sort by score descending
 *
 * The @N@ operator does NOT work with SDK bound parameters — the search term
 * must be embedded as a string literal. See:
 * https://github.com/surrealdb/surrealdb/issues/7013
 */

import type { Surreal } from "surrealdb";
import type { RecordId } from "surrealdb";
import type { RankedEntity, SearchEntityKind } from "./queries";

// ---------------------------------------------------------------------------
// Pure query builders
// ---------------------------------------------------------------------------

const ALL_SEARCH_KINDS: SearchEntityKind[] = [
  "project", "feature", "task", "decision", "question", "suggestion",
];

/** Table-to-text-field mapping for BM25 search */
const TABLE_TEXT_FIELD: Record<SearchEntityKind, { textField: string; kindLabel: string }> = {
  task:       { textField: "title",   kindLabel: "task" },
  decision:   { textField: "summary", kindLabel: "decision" },
  question:   { textField: "text",    kindLabel: "question" },
  feature:    { textField: "name",    kindLabel: "feature" },
  project:    { textField: "name",    kindLabel: "project" },
  suggestion: { textField: "text",    kindLabel: "suggestion" },
};

/** Escape a search query for safe interpolation inside a SurrealQL string literal. */
export function escapeSearchQuery(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Build BM25 fulltext search SQL across entity tables.
 *
 * Returns a multi-statement SQL string with one SELECT per table.
 * Each SELECT returns { id, kind, text, status, score } rows.
 *
 * Requires bound parameters: $workspace, $limit
 */
export function buildBm25SearchSQL(
  query: string,
  kinds?: SearchEntityKind[],
): string {
  const escaped = escapeSearchQuery(query);
  const q = `'${escaped}'`;
  const selectedKinds = kinds && kinds.length > 0 ? kinds : ALL_SEARCH_KINDS;

  const statements = selectedKinds.map((kind) => {
    const { textField, kindLabel } = TABLE_TEXT_FIELD[kind];
    const workspaceFilter = kind === "project"
      ? `id IN (SELECT VALUE out FROM has_project WHERE \`in\` = $workspace)`
      : `workspace = $workspace`;

    return `SELECT id, "${kindLabel}" AS kind, ${textField} AS text, status, search::score(1) AS score
FROM ${kind} WHERE ${textField} @1@ ${q} AND ${workspaceFilter} ORDER BY score DESC LIMIT $limit;`;
  });

  return statements.join("\n\n");
}

// ---------------------------------------------------------------------------
// BM25 search result row type (from SurrealDB)
// ---------------------------------------------------------------------------

type Bm25SearchRow = {
  id: RecordId<string, string>;
  kind: SearchEntityKind;
  text: string;
  status?: string;
  score: number;
};

// ---------------------------------------------------------------------------
// Effect boundary: execute BM25 search against SurrealDB
// ---------------------------------------------------------------------------

export async function searchEntitiesByBm25(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  query: string;
  kinds?: SearchEntityKind[];
  limit: number;
}): Promise<RankedEntity[]> {
  const trimmed = input.query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const sql = buildBm25SearchSQL(trimmed, input.kinds);
  const bindings = {
    workspace: input.workspaceRecord,
    limit: input.limit,
  };

  const results = await input.surreal.query(sql, bindings);

  // BM25 @N@ operator filters to matching rows. search::score(1) may return 0
  // in some SurrealDB versions despite correct matching -- treat all matched
  // rows as relevant. Sort by score descending (stable for score=0 ties).
  const allRows = (results as unknown as Bm25SearchRow[][])
    .filter(Array.isArray)
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);

  return allRows.map((row) => ({
    id: row.id.id as string,
    kind: row.kind,
    name: row.text,
    score: row.score,
    ...(row.status ? { status: row.status } : {}),
  }));
}
