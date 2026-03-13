/**
 * Three-layer collision detection for agent learnings.
 *
 * Checks new learning text against:
 *   1. Existing active learnings (duplicate > 0.90, LLM classify 0.75-0.90)
 *   2. Active policies (LLM classify > 0.80, contradiction = hard block)
 *   3. Confirmed decisions (LLM classify > 0.80, contradiction = informational)
 *
 * Uses two-step KNN pattern to avoid SurrealDB HNSW + WHERE index conflict.
 * LLM classification defaults to "contradicts" on failure (fail-safe).
 */
import { generateObject } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { z } from "zod";
import { logInfo, logWarn } from "../http/observability";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollisionClassification =
  | "contradicts"
  | "duplicates"
  | "reinforces"
  | "unrelated";

export type CollisionTargetKind = "learning" | "policy" | "decision";

export type CollisionResult = {
  collisionType: CollisionClassification;
  targetKind: CollisionTargetKind;
  targetId: string;
  targetText: string;
  similarity: number;
  blocking: boolean;
  reasoning?: string;
};

export type CollisionCheckResult = {
  collisions: CollisionResult[];
  hasBlockingCollision: boolean;
  deferred?: boolean;
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const LEARNING_THRESHOLD = 0.75;
const LEARNING_DUPLICATE_THRESHOLD = 0.90;
// Cross-entity thresholds are lower because embeddings of different entity types
// (learning text vs policy description vs decision summary) have lower cosine
// similarity even when topically related. The LLM classifier handles accuracy.
const POLICY_THRESHOLD = 0.40;
const DECISION_THRESHOLD = 0.55;

// ---------------------------------------------------------------------------
// LLM classification schema
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  classification: z.enum(["contradicts", "reinforces", "unrelated"]).describe(
    "How learning A relates to target B: contradicts (opposite/incompatible), reinforces (compatible/complementary), unrelated (different domains)",
  ),
  reasoning: z.string().describe("Brief explanation of the classification"),
});

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function checkCollisions(input: {
  surreal: Surreal;
  model: unknown;
  workspaceRecord: RecordId<"workspace", string>;
  learningText: string;
  learningEmbedding?: number[];
  source: "human" | "agent";
}): Promise<CollisionCheckResult> {
  const { surreal, model, workspaceRecord, learningText, learningEmbedding, source } = input;

  // Fail-open/closed when embedding unavailable
  if (!learningEmbedding) {
    if (source === "human") {
      return { collisions: [], hasBlockingCollision: false };
    }
    // Agent-suggested: defer collision check
    return { collisions: [], hasBlockingCollision: false, deferred: true };
  }

  const collisions: CollisionResult[] = [];

  // Layer 1: Learning-vs-learning
  const learningCandidates = await findSimilarRecords(surreal, workspaceRecord, learningEmbedding, LEARNING_SPEC);
  for (const candidate of learningCandidates) {
    if (candidate.similarity > LEARNING_DUPLICATE_THRESHOLD) {
      collisions.push({
        collisionType: "duplicates",
        targetKind: "learning",
        targetId: candidate.id,
        targetText: candidate.text,
        similarity: candidate.similarity,
        blocking: false,
      });
    } else if (candidate.similarity > LEARNING_THRESHOLD) {
      const classification = await classifyWithLlm(model, learningText, candidate.text);
      if (classification.classification !== "unrelated") {
        collisions.push({
          collisionType: classification.classification,
          targetKind: "learning",
          targetId: candidate.id,
          targetText: candidate.text,
          similarity: candidate.similarity,
          blocking: false,
          reasoning: classification.reasoning,
        });
      }
    }
  }

  // Layer 2: Learning-vs-policy (contradiction = hard block)
  const policyCandidates = await findSimilarRecords(surreal, workspaceRecord, learningEmbedding, POLICY_SPEC);
  for (const candidate of policyCandidates) {
    const classification = await classifyWithLlm(model, learningText, candidate.text);
    const isContradiction = classification.classification === "contradicts";
    if (classification.classification !== "unrelated") {
      collisions.push({
        collisionType: classification.classification,
        targetKind: "policy",
        targetId: candidate.id,
        targetText: candidate.text,
        similarity: candidate.similarity,
        blocking: isContradiction,
        reasoning: classification.reasoning,
      });
    }
  }

  // Layer 3: Learning-vs-decision (always informational)
  const decisionCandidates = await findSimilarRecords(surreal, workspaceRecord, learningEmbedding, DECISION_SPEC);
  for (const candidate of decisionCandidates) {
    const classification = await classifyWithLlm(model, learningText, candidate.text);
    if (classification.classification !== "unrelated") {
      collisions.push({
        collisionType: classification.classification,
        targetKind: "decision",
        targetId: candidate.id,
        targetText: candidate.text,
        similarity: candidate.similarity,
        blocking: false,
        reasoning: classification.reasoning,
      });
    }
  }

  const hasBlockingCollision = collisions.some((c) => c.blocking);

  logInfo("learning.collision.checked", "Collision check completed", {
    totalCollisions: collisions.length,
    hasBlockingCollision,
    learningCollisions: collisions.filter((c) => c.targetKind === "learning").length,
    policyCollisions: collisions.filter((c) => c.targetKind === "policy").length,
    decisionCollisions: collisions.filter((c) => c.targetKind === "decision").length,
  });

  return { collisions, hasBlockingCollision };
}

// ---------------------------------------------------------------------------
// LLM intent classification
// ---------------------------------------------------------------------------

async function classifyWithLlm(
  model: unknown,
  learningText: string,
  targetText: string,
): Promise<{ classification: "contradicts" | "reinforces" | "unrelated"; reasoning: string }> {
  try {
    const result = await generateObject({
      model: model as any,
      schema: classificationSchema,
      temperature: 0.1,
      prompt: [
        `Given learning A: "${learningText}"`,
        `And target B: "${targetText}"`,
        "",
        "Classify the relationship between A and B:",
        "- contradicts: A and B give opposite or incompatible instructions/constraints",
        "- reinforces: A and B are compatible, complementary, or point in the same direction",
        "- unrelated: A and B are about different topics or domains with no meaningful overlap",
      ].join("\n"),
    });
    return result.object;
  } catch (error) {
    // Fail-safe: default to "contradicts" when LLM unavailable
    logWarn("learning.collision.llm_failed", "LLM classification failed, defaulting to contradicts", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      classification: "contradicts",
      reasoning: "LLM classification unavailable; defaulting to contradicts for safety",
    };
  }
}

// ---------------------------------------------------------------------------
// KNN queries (two-step pattern for SurrealDB HNSW + WHERE bug)
// ---------------------------------------------------------------------------

type SimilarityCandidate = {
  id: string;
  text: string;
  similarity: number;
};

type KnnSearchSpec = {
  table: string;
  candidateFields: string;
  filterFields: string;
  textExtractor: (row: Record<string, unknown>) => string;
  filterClause: string;
  threshold: number;
};

const LEARNING_SPEC: KnnSearchSpec = {
  table: "learning",
  candidateFields: "id, text, workspace, status, vector::similarity::cosine(embedding, $embedding) AS similarity",
  filterFields: "id, text, similarity",
  textExtractor: (row) => row.text as string,
  filterClause: 'workspace = $ws AND status = "active"',
  threshold: LEARNING_THRESHOLD,
};

const POLICY_SPEC: KnnSearchSpec = {
  table: "policy",
  candidateFields: "id, title, description, workspace, status, vector::similarity::cosine(embedding, $embedding) AS similarity",
  filterFields: "id, title, description, similarity",
  textExtractor: (row) => (row.description as string | undefined) ?? (row.title as string),
  filterClause: 'workspace = $ws AND status = "active"',
  threshold: POLICY_THRESHOLD,
};

const DECISION_SPEC: KnnSearchSpec = {
  table: "decision",
  candidateFields: "id, summary, workspace, vector::similarity::cosine(embedding, $embedding) AS similarity",
  filterFields: "id, summary, similarity",
  textExtractor: (row) => row.summary as string,
  filterClause: "workspace = $ws",
  threshold: DECISION_THRESHOLD,
};

async function findSimilarRecords(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  embedding: number[],
  spec: KnnSearchSpec,
): Promise<SimilarityCandidate[]> {
  const sql = `
    LET $candidates = SELECT ${spec.candidateFields}
      FROM ${spec.table} WHERE embedding <|20, COSINE|> $embedding;
    SELECT ${spec.filterFields} FROM $candidates
      WHERE ${spec.filterClause} AND similarity > ${spec.threshold}
      ORDER BY similarity DESC LIMIT 10;
  `;
  const results = await surreal.query<[null, Array<Record<string, unknown> & { id: RecordId; similarity: number }>]>(sql, {
    embedding,
    ws: workspaceRecord,
  });
  const rows = results[1] ?? [];
  return rows.map((row) => ({
    id: row.id.id as string,
    text: spec.textExtractor(row),
    similarity: row.similarity,
  }));
}
