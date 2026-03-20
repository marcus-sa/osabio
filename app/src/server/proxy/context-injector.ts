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
import { RecordId } from "surrealdb";
import { escapeSearchQuery } from "../graph/bm25-search";

// ---------------------------------------------------------------------------
// Local cosine similarity (kept for legacy rankCandidates; no external dep)
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

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

export type Bm25ContextCandidate = {
  readonly id: string;
  readonly type: "decision" | "learning" | "observation";
  readonly text: string;
  readonly bm25Score: number;
  readonly updatedAt: string;
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
// BM25 + Recency Ranking (02-01: pure functions)
// ---------------------------------------------------------------------------

const DEFAULT_RECENCY_HALFLIFE_HOURS = 168; // 1 week

/**
 * Compute exponential recency decay factor.
 * decayFactor = exp(-ageHours / halflife)
 *
 * Returns 1.0 for zero or negative age (future timestamps treated as fresh).
 */
export function computeRecencyDecay(ageHours: number, halflife: number): number {
  if (ageHours <= 0) return 1.0;
  return Math.exp(-ageHours / halflife);
}

/**
 * Compute final context score: BM25 relevance weighted by recency decay.
 * finalScore = bm25Score * exp(-ageHours / halflife)
 */
export function computeFinalScore(
  bm25Score: number,
  updatedAt: string,
  now: Date,
  halflife: number,
): number {
  const ageMs = now.getTime() - new Date(updatedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return bm25Score * computeRecencyDecay(ageHours, halflife);
}

/**
 * Rank BM25 context candidates by combined relevance and recency.
 * Pure pipeline: map to final scores, sort descending.
 */
export function rankByBm25WithRecency(
  candidates: Bm25ContextCandidate[],
  now: Date,
  halflife: number = DEFAULT_RECENCY_HALFLIFE_HOURS,
): RankedCandidate[] {
  return candidates
    .map((c) => ({
      id: c.id,
      type: c.type,
      text: c.text,
      score: computeFinalScore(c.bm25Score, c.updatedAt, now, halflife),
    }))
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
// Recent Changes Injection into System Prompt (04-02: pure)
// ---------------------------------------------------------------------------

/**
 * Injects recent changes XML into a system prompt with correct ordering:
 * - <urgent-context> is injected BEFORE <brain-context>
 * - <context-update> is injected AFTER <brain-context>
 *
 * For array-form system prompts, each block becomes a separate text element
 * with cache_control: ephemeral.
 */
export function injectRecentChanges(
  system: SystemPrompt,
  recentChangesXml: string,
): InjectionResult["system"] {
  if (!recentChangesXml) return system ?? "";

  // Extract urgent-context and context-update blocks from the XML
  const urgentMatch = recentChangesXml.match(/<urgent-context>[\s\S]*?<\/urgent-context>/);
  const updateMatch = recentChangesXml.match(/<context-update>[\s\S]*?<\/context-update>/);

  const urgentBlock = urgentMatch?.[0] ?? "";
  const updateBlock = updateMatch?.[0] ?? "";

  if (!urgentBlock && !updateBlock) return system ?? "";

  if (Array.isArray(system)) {
    const result = [...system];

    // Find the brain-context block index for insertion ordering
    const brainContextIdx = result.findIndex(
      (block) => typeof block.text === "string" && block.text.includes("<brain-context>"),
    );

    if (brainContextIdx >= 0) {
      // Insert urgent BEFORE brain-context, update AFTER
      if (updateBlock) {
        result.splice(brainContextIdx + 1, 0, {
          type: "text",
          text: updateBlock,
          cache_control: { type: "ephemeral" },
        });
      }
      if (urgentBlock) {
        result.splice(brainContextIdx, 0, {
          type: "text",
          text: urgentBlock,
          cache_control: { type: "ephemeral" },
        });
      }
    } else {
      // No brain-context block -- append both at end (urgent first, then update)
      if (urgentBlock) {
        result.push({ type: "text", text: urgentBlock, cache_control: { type: "ephemeral" } });
      }
      if (updateBlock) {
        result.push({ type: "text", text: updateBlock, cache_control: { type: "ephemeral" } });
      }
    }

    return result;
  }

  if (typeof system === "string") {
    // String-form: find <brain-context> position for ordering
    const brainContextPos = system.indexOf("<brain-context>");

    if (brainContextPos >= 0) {
      const brainContextEnd = system.indexOf("</brain-context>");
      const afterBrainContext = brainContextEnd >= 0
        ? brainContextEnd + "</brain-context>".length
        : system.length;

      const before = system.slice(0, brainContextPos);
      const brainSection = system.slice(brainContextPos, afterBrainContext);
      const after = system.slice(afterBrainContext);

      const parts = [before.trimEnd()];
      if (urgentBlock) parts.push(urgentBlock);
      parts.push(brainSection);
      if (updateBlock) parts.push(updateBlock);
      parts.push(after.trimStart());

      return parts.filter(Boolean).join("\n\n");
    }

    // No brain-context -- append both
    const parts = [system];
    if (urgentBlock) parts.push(urgentBlock);
    if (updateBlock) parts.push(updateBlock);
    return parts.join("\n\n");
  }

  // No existing system prompt -- combine blocks
  const parts: string[] = [];
  if (urgentBlock) parts.push(urgentBlock);
  if (updateBlock) parts.push(updateBlock);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Recent Changes Classification (04-01: pure)
// ---------------------------------------------------------------------------

const URGENT_CONTEXT_THRESHOLD = 0.7;
const CONTEXT_UPDATE_THRESHOLD = 0.4;

/**
 * Classifies KNN search results by similarity into urgent-context or context-update.
 *
 * - >= 0.7 similarity  -> urgent-context (agent should act on this immediately)
 * - >= 0.4 similarity  -> context-update (background awareness)
 * - < 0.4 similarity   -> filtered out (not relevant)
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
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRecentChangesXml(changes: ClassifiedChange[]): string {
  if (changes.length === 0) return "";

  const urgent = changes.filter((c) => c.classification === "urgent-context");
  const updates = changes.filter((c) => c.classification === "context-update");

  const sections: string[] = [];

  if (urgent.length > 0) {
    const items = urgent
      .map((c) => `  <item type="${escapeXml(c.table)}">${escapeXml(c.text)}</item>`)
      .join("\n");
    sections.push(`<urgent-context>\n${items}\n</urgent-context>`);
  }

  if (updates.length > 0) {
    const items = updates
      .map((c) => `  <item type="${escapeXml(c.table)}">${escapeXml(c.text)}</item>`)
      .join("\n");
    sections.push(`<context-update>\n${items}\n</context-update>`);
  }

  return `<recent-changes>\n${sections.join("\n")}\n</recent-changes>`;
}

// ---------------------------------------------------------------------------
// Recent Changes BM25 Search (04-01 / 02-01: adapter boundary -- DB side effect)
// ---------------------------------------------------------------------------

/**
 * Port signature for searching recent graph changes by BM25 text relevance.
 * No embedding API calls -- uses fulltext indexes with recency filtering.
 */
export type SearchRecentChanges = (
  queryText: string,
  workspaceId: string,
  lastRequestAt: Date,
) => Promise<RecentChangeCandidate[]>;

type Bm25RecentRow = {
  id: RecordId;
  text: string;
  score: number;
  updated_at: string;
};

/**
 * Searches for recent graph entity changes relevant to a text query using BM25.
 *
 * Replaces KNN vector search (02-01): no embedding generation needed.
 * Uses BM25 fulltext indexes on decision.summary, task.title, observation.text.
 * The @N@ operator requires string literal interpolation (not SDK bound params).
 */
export function createSearchRecentChanges(
  surreal: { query: <T>(sql: string, vars?: Record<string, unknown>) => Promise<T> },
): SearchRecentChanges {
  return async (
    queryText: string,
    workspaceId: string,
    lastRequestAt: Date,
  ): Promise<RecentChangeCandidate[]> => {
    const trimmed = queryText.trim();
    if (trimmed.length === 0) return [];

    const workspaceRecord = new RecordId("workspace", workspaceId);
    const escaped = escapeSearchQuery(trimmed);
    const q = `'${escaped}'`;
    const limit = 20;

    // BM25 fulltext search across three tables -- single round-trip
    // @N@ must use string literal interpolation, not bound params
    const results = await surreal.query<[Bm25RecentRow[], Bm25RecentRow[], Bm25RecentRow[]]>(
      `SELECT id, summary AS text, search::score(1) AS score, updated_at
         FROM decision WHERE summary @1@ ${q} AND workspace = $ws AND updated_at > $since AND status != "superseded"
         ORDER BY score DESC LIMIT $limit;
       SELECT id, title AS text, search::score(1) AS score, updated_at
         FROM task WHERE title @1@ ${q} AND workspace = $ws AND updated_at > $since
         ORDER BY score DESC LIMIT $limit;
       SELECT id, text, search::score(1) AS score, updated_at
         FROM observation WHERE text @1@ ${q} AND workspace = $ws AND updated_at > $since
         ORDER BY score DESC LIMIT $limit;`,
      { ws: workspaceRecord, since: lastRequestAt, limit },
    );

    function toRecentChangeCandidates(
      rows: Bm25RecentRow[],
      table: RecentChangeCandidate["table"],
    ): RecentChangeCandidate[] {
      return rows.map((row) => ({
        id: (row.id as RecordId).id as string,
        table,
        text: row.text,
        similarity: row.score, // BM25 score used in place of cosine similarity
        updatedAt: row.updated_at,
      }));
    }

    return [
      ...toRecentChangeCandidates(results[0] ?? [], "decision"),
      ...toRecentChangeCandidates(results[1] ?? [], "task"),
      ...toRecentChangeCandidates(results[2] ?? [], "observation"),
    ];
  };
}

// ---------------------------------------------------------------------------
// BM25 Context Search (02-01: adapter boundary -- DB side effect)
// ---------------------------------------------------------------------------

/**
 * Port signature for searching context candidates by BM25 text relevance.
 */
export type SearchContextByBm25 = (
  queryText: string,
  workspaceId: string,
  limit: number,
) => Promise<Bm25ContextCandidate[]>;

type Bm25ContextRow = {
  id: RecordId;
  text: string;
  score: number;
  updated_at: string;
};

/**
 * Searches for context candidates (decisions, learnings, observations) using BM25 fulltext.
 *
 * Replaces embedding cosine similarity ranking (02-01).
 * Returns candidates with BM25 scores and timestamps for recency-weighted ranking.
 */
export function createSearchContextByBm25(
  surreal: { query: <T>(sql: string, vars?: Record<string, unknown>) => Promise<T> },
): SearchContextByBm25 {
  return async (
    queryText: string,
    workspaceId: string,
    limit: number,
  ): Promise<Bm25ContextCandidate[]> => {
    const trimmed = queryText.trim();
    if (trimmed.length === 0) return [];

    const workspaceRecord = new RecordId("workspace", workspaceId);
    const escaped = escapeSearchQuery(trimmed);
    const q = `'${escaped}'`;

    const results = await surreal.query<[Bm25ContextRow[], Bm25ContextRow[], Bm25ContextRow[]]>(
      `SELECT id, summary AS text, search::score(1) AS score, updated_at
         FROM decision WHERE summary @1@ ${q} AND workspace = $ws AND status = 'confirmed'
         ORDER BY score DESC LIMIT $limit;
       SELECT id, text, search::score(1) AS score, updated_at
         FROM learning WHERE text @1@ ${q} AND workspace = $ws AND status = 'active'
         ORDER BY score DESC LIMIT $limit;
       SELECT id, text, search::score(1) AS score, updated_at
         FROM observation WHERE text @1@ ${q} AND workspace = $ws AND status = 'open' AND severity IN ['conflict', 'warning'] AND source_agent != 'llm-proxy'
         ORDER BY score DESC LIMIT $limit;`,
      { ws: workspaceRecord, limit },
    );

    function toContextCandidates(
      rows: Bm25ContextRow[],
      type: Bm25ContextCandidate["type"],
    ): Bm25ContextCandidate[] {
      return rows.map((row) => ({
        id: (row.id as RecordId).id as string,
        type,
        text: row.text,
        bm25Score: row.score,
        updatedAt: row.updated_at,
      }));
    }

    return [
      ...toContextCandidates(results[0] ?? [], "decision"),
      ...toContextCandidates(results[1] ?? [], "learning"),
      ...toContextCandidates(results[2] ?? [], "observation"),
    ];
  };
}
