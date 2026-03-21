/**
 * BM25 fulltext search query builders and execution.
 *
 * Pattern:
 *   1. Per-table SELECT ... WHERE field @N@ $query AND workspace = $ws
 *   2. search::score(N) returns BM25 relevance score
 *   3. RRF (./rrf.ts) merges per-table ranked lists by rank position
 *
 * SurrealDB 3.0.4+: @N@ works with SDK bound parameters ($query).
 * search::score() returns real BM25 scores with BM25(1.2, 0.75).
 */

import type { Surreal } from "surrealdb";
import type { RecordId } from "surrealdb";
import type { RankedEntity, SearchEntityKind } from "./queries";
import { applyRrf, type RrfItem } from "./rrf";

// ---------------------------------------------------------------------------
// Term extraction (shared across all BM25 callers)
// ---------------------------------------------------------------------------

const BM25_STOP_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
  "is", "was", "are", "were", "be", "been", "being", "has", "had", "have",
  "do", "does", "did", "with", "by", "from", "that", "this", "it", "its",
  "not", "but", "if", "as", "so", "no", "can", "will", "during", "when",
  "while", "about", "into", "also", "just", "than", "more", "very",
  "all", "each", "every", "both", "few", "most", "some", "any", "other",
  "new", "old", "between", "after", "before", "above", "below",
  "should", "would", "could", "may", "might", "shall", "must",
  "caused", "detected", "found", "seen", "observed",
  "use", "using", "used",
]);

/**
 * Extracts key terms from text for BM25 matching.
 * Drops short/common words (stopwords) and words ≤ 2 chars.
 *
 * Callers use OR-predicate queries (`field @0@ $t0 OR field @1@ $t1 ...`)
 * so more terms = broader recall, matching embedding-era behavior where
 * every document got a similarity score.
 *
 * Pure function -- no IO.
 */
export function extractSearchTerms(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !BM25_STOP_WORDS.has(word))
    .join(" ");
}

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
