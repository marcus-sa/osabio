/**
 * Pattern Detection Module
 *
 * Rate limiting gate and dismissed re-suggestion prevention for agent-suggested learnings.
 * Pure functions that compose query results into blocking/allow decisions.
 *
 * Uses BM25 fulltext search for dismissed similarity detection (replaces KNN embeddings).
 */
import { RecordId, type Surreal } from "surrealdb";
import { countRecentSuggestionsByAgent, createLearning } from "./queries";
import type { CreateLearningInput, LearningRecord } from "./types";
import {
  buildDismissedSimilarityQuery,
  isDismissedSimilarityMatch,
  type Bm25LearningMatch,
} from "./bm25-collision";
import type { DismissedSimilarityResult } from "./collision-types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RateLimitResult =
  | { blocked: false; count: number }
  | { blocked: true; count: number };

export type { DismissedSimilarityResult } from "./collision-types";

export type SuggestLearningResult =
  | { created: true; learningRecord: LearningRecord }
  | { created: false; reason: "rate_limited"; count: number }
  | { created: false; reason: "dismissed_similarity"; matchedText: string };

// ---------------------------------------------------------------------------
// Rate limit check
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;

export async function checkRateLimit(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  agentType: string;
}): Promise<RateLimitResult> {
  const count = await countRecentSuggestionsByAgent({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    agentType: input.agentType,
  });

  return count >= RATE_LIMIT_MAX
    ? { blocked: true, count }
    : { blocked: false, count };
}

// ---------------------------------------------------------------------------
// Dismissed similarity check (BM25 fulltext search)
// ---------------------------------------------------------------------------

export async function checkDismissedSimilarity(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  proposedText: string;
}): Promise<DismissedSimilarityResult> {
  const trimmed = input.proposedText.trim();
  if (trimmed.length === 0) {
    return { blocked: false };
  }

  const sql = buildDismissedSimilarityQuery();

  const [rows] = await input.surreal.query<[Bm25LearningMatch[]]>(
    sql,
    { ws: input.workspaceRecord, query: trimmed },
  );

  const matches = rows ?? [];

  log.info("learning.dismissed.bm25_check", "BM25 dismissed similarity check", {
    matchCount: matches.length,
    topScore: matches[0]?.score,
    proposedTextPrefix: trimmed.slice(0, 80),
  });

  return isDismissedSimilarityMatch(matches);
}

// ---------------------------------------------------------------------------
// Suggest learning (orchestrates gates then creates)
// ---------------------------------------------------------------------------

export async function suggestLearning(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  learning: CreateLearningInput;
  now: Date;
}): Promise<SuggestLearningResult> {
  const agentType = input.learning.suggestedBy ?? "unknown_agent";

  // Gate 1: Rate limit
  const rateLimit = await checkRateLimit({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    agentType,
  });

  if (rateLimit.blocked) {
    return { created: false, reason: "rate_limited", count: rateLimit.count };
  }

  // Gate 2: Dismissed similarity (BM25 fulltext -- no embedding needed)
  const dismissed = await checkDismissedSimilarity({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    proposedText: input.learning.text,
  });

  if (dismissed.blocked) {
    return {
      created: false,
      reason: "dismissed_similarity",
      matchedText: dismissed.matchedText,
    };
  }

  // Both gates passed -- create learning as pending_approval
  const learningRecord = await createLearning({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    learning: {
      ...input.learning,
      source: "agent",
    },
    now: input.now,
  });

  return { created: true, learningRecord };
}
