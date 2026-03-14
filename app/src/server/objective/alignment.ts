/**
 * Pure Alignment Evaluator
 *
 * Computes cosine similarity between intent and objective embeddings,
 * then classifies the alignment result.
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
