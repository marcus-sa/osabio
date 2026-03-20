/**
 * BM25 fulltext search query builders — pure functions for constructing
 * SurrealDB BM25 search queries.
 *
 * Pattern:
 *   1. Per-table SELECT ... WHERE field @N@ $query AND workspace = $ws
 *   2. search::score(N) returns BM25 relevance score
 *   3. Reciprocal Rank Fusion (RRF) merges per-table ranked lists
 *
 * RRF (Cormack et al., k=60) fuses results by rank position rather than
 * raw score, eliminating cross-table BM25 score incomparability.
 *
 * SurrealDB 3.0.4+: @N@ works with SDK bound parameters ($query).
 * search::score() returns real BM25 scores with BM25(1.2, 0.75).
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

/**
 * Build BM25 fulltext search SQL across entity tables.
 *
 * Returns a multi-statement SQL string with one SELECT per table.
 * Each SELECT returns { id, kind, text, status, score } rows.
 *
 * Requires bound parameters: $workspace, $limit, $query
 */
export function buildBm25SearchSQL(
  kinds?: SearchEntityKind[],
): string {
  const selectedKinds = kinds && kinds.length > 0 ? kinds : ALL_SEARCH_KINDS;

  const statements = selectedKinds.map((kind) => {
    const { textField, kindLabel } = TABLE_TEXT_FIELD[kind];
    const workspaceFilter = kind === "project"
      ? `id IN (SELECT VALUE out FROM has_project WHERE \`in\` = $workspace)`
      : `workspace = $workspace`;

    return `SELECT id, "${kindLabel}" AS kind, ${textField} AS text, status, search::score(1) AS score
FROM ${kind} WHERE ${textField} @1@ $query AND ${workspaceFilter} ORDER BY score DESC LIMIT $limit;`;
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
// Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

/** Default RRF constant — dampens influence of high-rank outliers (Cormack et al.) */
const RRF_K = 60;

/**
 * Item in a per-table ranked list. Must carry enough identity to deduplicate
 * across lists (same entity appearing in multiple table queries is unlikely
 * for BM25 cross-table search, but the algorithm handles it correctly).
 */
export type RrfItem<T> = T & { readonly _rrfKey: string };

/**
 * Reciprocal Rank Fusion — merges multiple independently-ranked lists into
 * a single fused ranking using rank position rather than raw scores.
 *
 * RRF_score(d) = Σ 1 / (k + rank_i(d))
 *
 * Each input list must already be sorted by relevance descending (rank 1 = best).
 * Items are identified by `_rrfKey`; if the same key appears in multiple lists,
 * its RRF contributions are summed (true fusion).
 *
 * Pure function — no IO, no side effects.
 */
export function applyRrf<T>(
  rankedLists: ReadonlyArray<ReadonlyArray<RrfItem<T>>>,
  limit: number,
  k: number = RRF_K,
): Array<T & { rrfScore: number }> {
  const scores = new Map<string, { item: T; rrfScore: number }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const entry = list[rank];
      const contribution = 1 / (k + rank + 1); // rank is 0-based, RRF uses 1-based
      const existing = scores.get(entry._rrfKey);
      if (existing) {
        existing.rrfScore += contribution;
      } else {
        // Strip _rrfKey from the stored item
        const { _rrfKey, ...item } = entry;
        scores.set(entry._rrfKey, { item: item as T, rrfScore: contribution });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ item, rrfScore }) => ({ ...item, rrfScore }));
}

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

  const sql = buildBm25SearchSQL(input.kinds);
  const bindings = {
    workspace: input.workspaceRecord,
    limit: input.limit,
    query: trimmed,
  };

  const results = await input.surreal.query(sql, bindings);

  // Group results into per-table ranked lists for RRF fusion
  const allArrays = (results as unknown as Bm25SearchRow[][]).filter(Array.isArray);
  const rankedLists = allArrays.map((rows) =>
    rows.map((row) => ({
      _rrfKey: `${row.kind}:${row.id.id as string}`,
      id: row.id,
      kind: row.kind,
      text: row.text,
      status: row.status,
      score: row.score,
    } as const satisfies RrfItem<Bm25SearchRow>)),
  );

  const fused = applyRrf(rankedLists, input.limit);

  return fused.map((row) => ({
    id: row.id.id as string,
    kind: row.kind,
    name: row.text,
    score: row.rrfScore,
    ...(row.status ? { status: row.status } : {}),
  }));
}
