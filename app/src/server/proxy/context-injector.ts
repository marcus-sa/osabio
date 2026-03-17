/**
 * Context Injector -- Pure functions for brain-context injection
 *
 * Responsible for:
 * 1. Ranking context candidates by weighted cosine similarity
 * 2. Selecting top N within token budget
 * 3. Building <brain-context> XML block
 * 4. Injecting into system prompt (string or array form)
 *
 * All functions are pure -- no IO, no side effects.
 * The orchestration (embedding, cache, DB queries) lives in the proxy route.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextCandidate = {
  readonly id: string;
  readonly type: "decision" | "learning" | "observation";
  readonly text: string;
  readonly embedding?: number[];
  readonly weight: number;
};

export type RankedCandidate = {
  readonly id: string;
  readonly type: "decision" | "learning" | "observation";
  readonly text: string;
  readonly score: number;
};

export type InjectionResult = {
  readonly system: string | Array<{ type: string; text: string; cache_control?: { type: string } }>;
  readonly injected: boolean;
  readonly tokensEstimated: number;
  readonly decisionsCount: number;
  readonly learningsCount: number;
  readonly observationsCount: number;
};

type SystemPrompt = string | Array<{ type: string; text: string; cache_control?: { type: string } }> | undefined;

// ---------------------------------------------------------------------------
// Recent Changes Types (04-01: vector search classification)
// ---------------------------------------------------------------------------

export type RecentChangeCandidate = {
  readonly id: string;
  readonly table: "decision" | "task" | "observation";
  readonly text: string;
  readonly similarity: number;
  readonly updatedAt: string;
};

export type ClassifiedChange = RecentChangeCandidate & {
  readonly classification: "urgent-context" | "context-update";
};

import { cosineSimilarity } from "../graph/embeddings";

// ---------------------------------------------------------------------------
// Token Estimation (pure, ~4 chars per token)
// ---------------------------------------------------------------------------

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Ranking: weighted cosine similarity
// ---------------------------------------------------------------------------

export function rankCandidates(
  candidates: ContextCandidate[],
  queryEmbedding: number[],
): RankedCandidate[] {
  return candidates
    .map((c) => {
      const hasEmbedding = c.embedding !== undefined && c.embedding.length > 0;
      const score = hasEmbedding
        ? cosineSimilarity(c.embedding!, queryEmbedding) * c.weight
        : c.weight * 0.5;
      return { id: c.id, type: c.type, text: c.text, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Budget Selection: top N within token budget
// ---------------------------------------------------------------------------

export function selectWithinBudget(
  ranked: RankedCandidate[],
  tokenBudget: number,
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  let tokensUsed = 0;

  for (const candidate of ranked) {
    const candidateTokens = estimateTokenCount(candidate.text);
    if (tokensUsed + candidateTokens > tokenBudget) break;
    selected.push(candidate);
    tokensUsed += candidateTokens;
  }

  return selected;
}

// ---------------------------------------------------------------------------
// XML Block Construction
// ---------------------------------------------------------------------------

export function buildBrainContextXml(selected: RankedCandidate[]): string {
  if (selected.length === 0) return "";

  const decisions = selected.filter((c) => c.type === "decision");
  const learnings = selected.filter((c) => c.type === "learning");
  const observations = selected.filter((c) => c.type === "observation");

  const sections: string[] = [];

  if (decisions.length > 0) {
    const items = decisions.map((d) => `  <item>${d.text}</item>`).join("\n");
    sections.push(`<decisions>\n${items}\n</decisions>`);
  }

  if (learnings.length > 0) {
    const items = learnings.map((l) => `  <item>${l.text}</item>`).join("\n");
    sections.push(`<learnings>\n${items}\n</learnings>`);
  }

  if (observations.length > 0) {
    const items = observations.map((o) => `  <item>${o.text}</item>`).join("\n");
    sections.push(`<observations>\n${items}\n</observations>`);
  }

  return `<brain-context>\n${sections.join("\n")}\n</brain-context>`;
}

// ---------------------------------------------------------------------------
// System Prompt Injection
// ---------------------------------------------------------------------------

export function injectBrainContext(
  originalSystem: SystemPrompt,
  brainContextXml: string,
): InjectionResult {
  if (!brainContextXml) {
    return {
      system: originalSystem ?? "",
      injected: false,
      tokensEstimated: 0,
      decisionsCount: 0,
      learningsCount: 0,
      observationsCount: 0,
    };
  }

  const tokensEstimated = estimateTokenCount(brainContextXml);

  // Count items in XML (by counting <item> tags per section)
  const decisionsCount = (brainContextXml.match(/<decisions>[\s\S]*?<\/decisions>/)?.[0]?.match(/<item>/g) ?? []).length;
  const learningsCount = (brainContextXml.match(/<learnings>[\s\S]*?<\/learnings>/)?.[0]?.match(/<item>/g) ?? []).length;
  const observationsCount = (brainContextXml.match(/<observations>[\s\S]*?<\/observations>/)?.[0]?.match(/<item>/g) ?? []).length;

  if (Array.isArray(originalSystem)) {
    // Array-form: append brain-context as additional text block with cache_control: ephemeral
    const enriched = [
      ...originalSystem,
      {
        type: "text",
        text: brainContextXml,
        cache_control: { type: "ephemeral" },
      },
    ];

    return {
      system: enriched,
      injected: true,
      tokensEstimated,
      decisionsCount,
      learningsCount,
      observationsCount,
    };
  }

  if (typeof originalSystem === "string") {
    // String-form: append brain-context after original text
    return {
      system: `${originalSystem}\n\n${brainContextXml}`,
      injected: true,
      tokensEstimated,
      decisionsCount,
      learningsCount,
      observationsCount,
    };
  }

  // No original system prompt: use brain-context as system prompt
  return {
    system: brainContextXml,
    injected: true,
    tokensEstimated,
    decisionsCount,
    learningsCount,
    observationsCount,
  };
}

// ---------------------------------------------------------------------------
// Recent Changes Classification (04-01: pure)
// ---------------------------------------------------------------------------

const URGENT_CONTEXT_THRESHOLD = 0.85;
const CONTEXT_UPDATE_THRESHOLD = 0.65;

/**
 * Classifies KNN search results by similarity into urgent-context or context-update.
 *
 * - >= 0.85 similarity -> urgent-context (agent should act on this immediately)
 * - >= 0.65 similarity -> context-update (background awareness)
 * - < 0.65 similarity  -> filtered out (not relevant)
 *
 * Preserves input order for candidates that pass the threshold.
 */
export function classifyBySimilarity(
  candidates: RecentChangeCandidate[],
): ClassifiedChange[] {
  return candidates
    .filter((c) => c.similarity >= CONTEXT_UPDATE_THRESHOLD)
    .map((c) => ({
      ...c,
      classification: c.similarity >= URGENT_CONTEXT_THRESHOLD
        ? "urgent-context" as const
        : "context-update" as const,
    }));
}

// ---------------------------------------------------------------------------
// Recent Changes XML Builder (04-01: pure)
// ---------------------------------------------------------------------------

/**
 * Builds an XML block for recent graph changes classified by urgency.
 *
 * Output structure:
 * <recent-changes>
 *   <urgent-context>
 *     <item type="decision">Use tRPC for all APIs</item>
 *   </urgent-context>
 *   <context-update>
 *     <item type="task">Implement rate limiting</item>
 *   </context-update>
 * </recent-changes>
 */
export function buildRecentChangesXml(changes: ClassifiedChange[]): string {
  if (changes.length === 0) return "";

  const urgent = changes.filter((c) => c.classification === "urgent-context");
  const updates = changes.filter((c) => c.classification === "context-update");

  const sections: string[] = [];

  if (urgent.length > 0) {
    const items = urgent
      .map((c) => `  <item type="${c.table}">${c.text}</item>`)
      .join("\n");
    sections.push(`<urgent-context>\n${items}\n</urgent-context>`);
  }

  if (updates.length > 0) {
    const items = updates
      .map((c) => `  <item type="${c.table}">${c.text}</item>`)
      .join("\n");
    sections.push(`<context-update>\n${items}\n</context-update>`);
  }

  return `<recent-changes>\n${sections.join("\n")}\n</recent-changes>`;
}

// ---------------------------------------------------------------------------
// Recent Changes Vector Search (04-01: adapter boundary -- DB side effect)
// ---------------------------------------------------------------------------

import { RecordId } from "surrealdb";

/**
 * Port signature for searching recent graph changes by vector similarity.
 */
export type SearchRecentChanges = (
  messageEmbedding: number[],
  workspaceId: string,
  lastRequestAt: Date,
) => Promise<RecentChangeCandidate[]>;

type KnnRow = {
  id: RecordId;
  text: string;
  similarity: number;
  updated_at: string;
  workspace: RecordId;
};

/**
 * Searches for recent graph entity changes relevant to a message embedding.
 *
 * Uses the two-step KNN pattern required by SurrealDB v3.0 (see CLAUDE.md):
 * - Step 1: KNN candidates via HNSW index (no WHERE filter)
 * - Step 2: filter by workspace + updated_at > last_request_at
 *
 * Queries decision, task, and observation tables independently then merges results.
 */
export function createSearchRecentChanges(
  surreal: { query: <T>(sql: string, vars?: Record<string, unknown>) => Promise<T> },
): SearchRecentChanges {
  return async (
    messageEmbedding: number[],
    workspaceId: string,
    lastRequestAt: Date,
  ): Promise<RecentChangeCandidate[]> => {
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const knnLimit = 20;

    // Two-step KNN pattern for each table (HNSW index cannot combine with B-tree WHERE)
    // Sequential queries to avoid SurrealDB SDK WebSocket concurrency issues
    const decisionResults = await surreal.query<[KnnRow[], KnnRow[]]>(
      `LET $candidates = SELECT id, summary AS text, vector::similarity::cosine(embedding, $vec) AS similarity, updated_at, workspace
         FROM decision WHERE embedding <|${knnLimit}, COSINE|> $vec;
       SELECT * FROM $candidates WHERE workspace = $ws AND updated_at > $since ORDER BY similarity DESC LIMIT $limit;`,
      { vec: messageEmbedding, ws: workspaceRecord, since: lastRequestAt, limit: knnLimit },
    );

    const taskResults = await surreal.query<[KnnRow[], KnnRow[]]>(
      `LET $candidates = SELECT id, title AS text, vector::similarity::cosine(embedding, $vec) AS similarity, updated_at, workspace
         FROM task WHERE embedding <|${knnLimit}, COSINE|> $vec;
       SELECT * FROM $candidates WHERE workspace = $ws AND updated_at > $since ORDER BY similarity DESC LIMIT $limit;`,
      { vec: messageEmbedding, ws: workspaceRecord, since: lastRequestAt, limit: knnLimit },
    );

    const observationResults = await surreal.query<[KnnRow[], KnnRow[]]>(
      `LET $candidates = SELECT id, text, vector::similarity::cosine(embedding, $vec) AS similarity, updated_at, workspace
         FROM observation WHERE embedding <|${knnLimit}, COSINE|> $vec;
       SELECT * FROM $candidates WHERE workspace = $ws AND updated_at > $since ORDER BY similarity DESC LIMIT $limit;`,
      { vec: messageEmbedding, ws: workspaceRecord, since: lastRequestAt, limit: knnLimit },
    );

    function toRecentChangeCandidates(
      rows: KnnRow[],
      table: RecentChangeCandidate["table"],
    ): RecentChangeCandidate[] {
      return rows.map((row) => ({
        id: (row.id as RecordId).id as string,
        table,
        text: row.text,
        similarity: row.similarity,
        updatedAt: row.updated_at,
      }));
    }

    return [
      ...toRecentChangeCandidates(decisionResults[1] ?? [], "decision"),
      ...toRecentChangeCandidates(taskResults[1] ?? [], "task"),
      ...toRecentChangeCandidates(observationResults[1] ?? [], "observation"),
    ];
  };
}
