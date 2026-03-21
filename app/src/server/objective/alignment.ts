/**
 * Pure Alignment Evaluator
 *
 * Classifies alignment between intents and objectives using:
 *   - Graph traversal candidates (deterministic, score = 1.0)
 *   - BM25 fulltext candidates (normalized, capped at ambiguous)
 *   - Cosine similarity (legacy embedding path)
 *
 * PURE MODULE: No IO imports, no side effects. Receives data, returns data.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlignmentClassification = "matched" | "ambiguous" | "none";

export type AlignmentCandidate = {
  objectiveId: string;
  title: string;
  score: number;
};

export type AlignmentMethod = "embedding" | "manual" | "rule" | "graph" | "bm25";

/** Raw graph traversal row — objectiveId + title, no score (deterministic). */
export type GraphObjectiveRow = {
  objectiveId: string;
  title: string;
};

/** Raw BM25 search row — objectiveId + title + raw BM25 score. */
export type Bm25ObjectiveRow = {
  objectiveId: string;
  title: string;
  score: number;
};

export type AlignmentResult = {
  classification: AlignmentClassification;
  objectiveId?: string;
  title?: string;
  score: number;
};

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

/**
 * Computes cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude.
 */
export function computeCosineSimilarity(
  vectorA: number[],
  vectorB: number[],
): number {
  if (vectorA.length !== vectorB.length) {
    throw new Error(
      `Vector length mismatch: vectorA has ${vectorA.length} dimensions, vectorB has ${vectorB.length}`,
    );
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const MATCHED_THRESHOLD = 0.7;
const AMBIGUOUS_THRESHOLD = 0.5;

/**
 * Classifies a cosine similarity score into an alignment category.
 *
 * - matched:   score >= 0.7 (strong semantic alignment)
 * - ambiguous: score >= 0.5 (weak alignment, human review suggested)
 * - none:      score < 0.5  (no meaningful alignment)
 */
export function classifyAlignment(score: number): AlignmentClassification {
  if (score >= MATCHED_THRESHOLD) return "matched";
  if (score >= AMBIGUOUS_THRESHOLD) return "ambiguous";
  return "none";
}

// ---------------------------------------------------------------------------
// Best Match Selection
// ---------------------------------------------------------------------------

/**
 * Selects the best alignment from a list of scored candidates.
 *
 * Returns the highest-scoring candidate with its classification.
 * If no candidates exist or the best score is below the ambiguous threshold,
 * the objectiveId is omitted from the result.
 */
export function selectBestAlignment(
  candidates: AlignmentCandidate[],
): AlignmentResult {
  if (candidates.length === 0) {
    return { classification: "none", score: 0 };
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const classification = classifyAlignment(best.score);

  if (classification === "none") {
    return { classification, score: best.score };
  }

  return {
    classification,
    objectiveId: best.objectiveId,
    title: best.title,
    score: best.score,
  };
}

// ---------------------------------------------------------------------------
// Graph Traversal Candidates
// ---------------------------------------------------------------------------

/**
 * Transforms graph traversal results into alignment candidates.
 *
 * Graph-linked objectives get deterministic score = 1.0 because the
 * relationship is explicit (task->belongs_to->project<-has_objective<-objective).
 */
export function buildGraphTraversalCandidates(
  rows: GraphObjectiveRow[],
): AlignmentCandidate[] {
  return rows.map((row) => ({
    objectiveId: row.objectiveId,
    title: row.title,
    score: 1.0,
  }));
}

// ---------------------------------------------------------------------------
// BM25 Candidates
// ---------------------------------------------------------------------------

/** Maximum normalized score for BM25 results — caps below matched threshold. */
const BM25_MAX_NORMALIZED_SCORE = 0.69;
/** Minimum normalized score for BM25 results with a positive raw score. */
const BM25_MIN_NORMALIZED_SCORE = 0.5;

/**
 * Transforms BM25 fulltext search results into alignment candidates.
 *
 * BM25 scores are normalized to the ambiguous range [0.5, 0.69] because
 * text matching is a weaker signal than graph traversal. This ensures
 * BM25 results classify as "ambiguous", never "matched".
 *
 * Results are sorted by score descending.
 */
export function buildBm25Candidates(
  rows: Bm25ObjectiveRow[],
): AlignmentCandidate[] {
  if (rows.length === 0) return [];

  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const maxRawScore = sorted[0].score;

  return sorted.map((row) => ({
    objectiveId: row.objectiveId,
    title: row.title,
    score: normalizeBm25Score(row.score, maxRawScore),
  }));
}

/**
 * Normalizes a raw BM25 score to the ambiguous range.
 * Maps [0, maxRaw] -> [BM25_MIN, BM25_MAX].
 */
function normalizeBm25Score(rawScore: number, maxRawScore: number): number {
  if (maxRawScore <= 0) return BM25_MIN_NORMALIZED_SCORE;
  const ratio = rawScore / maxRawScore;
  return BM25_MIN_NORMALIZED_SCORE + ratio * (BM25_MAX_NORMALIZED_SCORE - BM25_MIN_NORMALIZED_SCORE);
}
