/**
 * Three-layer collision detection for agent learnings.
 *
 * Checks new learning text against:
 *   1. Existing active learnings (BM25 match + LLM classify)
 *   2. Active policies (BM25 match + LLM classify, contradiction = hard block)
 *   3. Confirmed decisions (BM25 match + LLM classify, contradiction = informational)
 *
 * Uses BM25 fulltext search for candidate retrieval, LLM for classification.
 */
import { generateObject } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { z } from "zod";
import { createTelemetryConfig } from "../telemetry/ai-telemetry";
import { FUNCTION_IDS } from "../telemetry/function-ids";
import { log } from "../telemetry/logger";

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
  source: "human" | "agent";
}): Promise<CollisionCheckResult> {
  const { surreal, model, workspaceRecord, learningText } = input;
  const collisions: CollisionResult[] = [];

  // Layer 1: Learning-vs-learning (BM25)
  const learningCandidates = await findSimilarByBm25(surreal, workspaceRecord, learningText, {
    table: "learning",
    textField: "text",
    extraFilter: 'AND status = "active"',
  });
  for (const candidate of learningCandidates) {
    const classification = await classifyWithLlm(model, learningText, candidate.text);
    if (classification.classification !== "unrelated") {
      collisions.push({
        collisionType: classification.classification === "contradicts" ? "contradicts" : "duplicates",
        targetKind: "learning",
        targetId: candidate.id,
        targetText: candidate.text,
        similarity: candidate.score,
        blocking: false,
        reasoning: classification.reasoning,
      });
    }
  }

  // Layer 2: Learning-vs-policy (contradiction = hard block)
  const policyCandidates = await findSimilarByBm25(surreal, workspaceRecord, learningText, {
    table: "policy",
    textField: "description",
    extraFilter: 'AND status = "active"',
  });
  for (const candidate of policyCandidates) {
    const classification = await classifyWithLlm(model, learningText, candidate.text);
    const isContradiction = classification.classification === "contradicts";
    if (classification.classification !== "unrelated") {
      collisions.push({
        collisionType: classification.classification,
        targetKind: "policy",
        targetId: candidate.id,
        targetText: candidate.text,
        similarity: candidate.score,
        blocking: isContradiction,
        reasoning: classification.reasoning,
      });
    }
  }

  // Layer 3: Learning-vs-decision (always informational)
  const decisionCandidates = await findSimilarByBm25(surreal, workspaceRecord, learningText, {
    table: "decision",
    textField: "summary",
    extraFilter: "",
  });
  for (const candidate of decisionCandidates) {
    const classification = await classifyWithLlm(model, learningText, candidate.text);
    if (classification.classification !== "unrelated") {
      collisions.push({
        collisionType: classification.classification,
        targetKind: "decision",
        targetId: candidate.id,
        targetText: candidate.text,
        similarity: candidate.score,
        blocking: false,
        reasoning: classification.reasoning,
      });
    }
  }

  const hasBlockingCollision = collisions.some((c) => c.blocking);

  log.info("learning.collision.checked", "Collision check completed", {
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
      experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.EXTRACTION),
      abortSignal: AbortSignal.timeout(30_000),
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
    log.warn("learning.collision.llm_failed", "LLM classification failed, defaulting to contradicts", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      classification: "contradicts",
      reasoning: "LLM classification unavailable; defaulting to contradicts for safety",
    };
  }
}

// ---------------------------------------------------------------------------
// BM25 fulltext search for cross-entity collision detection
// ---------------------------------------------------------------------------

type Bm25Candidate = {
  id: string;
  text: string;
  score: number;
};

type Bm25SearchSpec = {
  table: string;
  textField: string;
  extraFilter: string;
};

async function findSimilarByBm25(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  searchText: string,
  spec: Bm25SearchSpec,
): Promise<Bm25Candidate[]> {
  const sql = `SELECT id, ${spec.textField} AS text, search::score(1) AS score
FROM ${spec.table}
WHERE ${spec.textField} @1@ $query
AND workspace = $ws
${spec.extraFilter}
ORDER BY score DESC
LIMIT 10;`;

  const [rows] = await surreal.query<[Array<{ id: RecordId; text: string; score: number }>]>(
    sql,
    { ws: workspaceRecord, query: searchText },
  );

  return (rows ?? []).map((row) => ({
    id: row.id.id as string,
    text: row.text,
    score: row.score,
  }));
}
