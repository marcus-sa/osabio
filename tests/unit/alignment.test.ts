/**
 * Unit Tests: Pure Alignment Evaluator
 *
 * Tests the pure cosine similarity and classification logic in alignment.ts.
 * No IO, no database, no mocks -- pure function tests only.
 *
 * Behaviors under test:
 * 1. Cosine similarity computation returns correct values
 * 2. Classification: matched (>= 0.7), ambiguous (>= 0.5), none (< 0.5)
 * 3. Best match selection from multiple candidates
 * 4. Edge cases: zero vectors, identical vectors, empty candidates
 */
import { describe, expect, it } from "bun:test";
import {
  computeCosineSimilarity,
  classifyAlignment,
  selectBestAlignment,
  buildGraphTraversalCandidates,
  buildBm25Candidates,
  type AlignmentClassification,
  type AlignmentCandidate,
  type AlignmentResult,
} from "../../app/src/server/objective/alignment";

// ---------------------------------------------------------------------------
// Cosine Similarity Computation
// ---------------------------------------------------------------------------

describe("computeCosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const vec = [0.5, 0.3, 0.8, 0.1];
    const similarity = computeCosineSimilarity(vec, vec);
    expect(similarity).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const similarity = computeCosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.0, 5);
  });

  it("returns -1.0 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const similarity = computeCosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(-1.0, 5);
  });

  it("returns 0.0 when either vector is zero", () => {
    const zero = [0, 0, 0];
    const vec = [1, 2, 3];
    expect(computeCosineSimilarity(zero, vec)).toBe(0);
    expect(computeCosineSimilarity(vec, zero)).toBe(0);
  });

  it("computes correct similarity for known vectors", () => {
    // cos([1,2,3], [4,5,6]) = (4+10+18) / (sqrt(14) * sqrt(77)) = 32 / sqrt(1078) ~ 0.9746
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const similarity = computeCosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.9746, 3);
  });
});

// ---------------------------------------------------------------------------
// Alignment Classification
// ---------------------------------------------------------------------------

describe("classifyAlignment", () => {
  it("classifies score >= 0.7 as matched", () => {
    expect(classifyAlignment(0.7)).toBe("matched");
    expect(classifyAlignment(0.85)).toBe("matched");
    expect(classifyAlignment(1.0)).toBe("matched");
  });

  it("classifies score >= 0.5 and < 0.7 as ambiguous", () => {
    expect(classifyAlignment(0.5)).toBe("ambiguous");
    expect(classifyAlignment(0.65)).toBe("ambiguous");
    expect(classifyAlignment(0.699)).toBe("ambiguous");
  });

  it("classifies score < 0.5 as none", () => {
    expect(classifyAlignment(0.0)).toBe("none");
    expect(classifyAlignment(0.3)).toBe("none");
    expect(classifyAlignment(0.499)).toBe("none");
  });

  it("classifies negative scores as none", () => {
    expect(classifyAlignment(-0.5)).toBe("none");
    expect(classifyAlignment(-1.0)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Best Match Selection
// ---------------------------------------------------------------------------

describe("selectBestAlignment", () => {
  it("returns none result when candidates list is empty", () => {
    const result = selectBestAlignment([]);
    expect(result.classification).toBe("none");
    expect(result.score).toBe(0);
    expect(result.objectiveId).toBeUndefined();
  });

  it("selects highest-scoring candidate", () => {
    const candidates: AlignmentCandidate[] = [
      { objectiveId: "obj-1", title: "First", score: 0.65 },
      { objectiveId: "obj-2", title: "Second", score: 0.87 },
      { objectiveId: "obj-3", title: "Third", score: 0.72 },
    ];
    const result = selectBestAlignment(candidates);
    expect(result.classification).toBe("matched");
    expect(result.objectiveId).toBe("obj-2");
    expect(result.score).toBe(0.87);
  });

  it("returns ambiguous when best score is between 0.5 and 0.7", () => {
    const candidates: AlignmentCandidate[] = [
      { objectiveId: "obj-1", title: "First", score: 0.55 },
      { objectiveId: "obj-2", title: "Second", score: 0.62 },
    ];
    const result = selectBestAlignment(candidates);
    expect(result.classification).toBe("ambiguous");
    expect(result.objectiveId).toBe("obj-2");
    expect(result.score).toBe(0.62);
  });

  it("returns none when all scores are below 0.5", () => {
    const candidates: AlignmentCandidate[] = [
      { objectiveId: "obj-1", title: "First", score: 0.3 },
      { objectiveId: "obj-2", title: "Second", score: 0.1 },
    ];
    const result = selectBestAlignment(candidates);
    expect(result.classification).toBe("none");
    expect(result.score).toBe(0.3);
    expect(result.objectiveId).toBeUndefined();
  });

  it("returns matched with single candidate above threshold", () => {
    const candidates: AlignmentCandidate[] = [
      { objectiveId: "obj-1", title: "Only One", score: 0.92 },
    ];
    const result = selectBestAlignment(candidates);
    expect(result.classification).toBe("matched");
    expect(result.objectiveId).toBe("obj-1");
    expect(result.score).toBe(0.92);
  });
});

// ---------------------------------------------------------------------------
// Graph Traversal Candidates
// ---------------------------------------------------------------------------

describe("buildGraphTraversalCandidates", () => {
  it("transforms graph rows to candidates with score 1.0", () => {
    const graphRows = [
      { objectiveId: "obj-1", title: "Improve reliability" },
      { objectiveId: "obj-2", title: "Increase velocity" },
    ];
    const candidates = buildGraphTraversalCandidates(graphRows);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].score).toBe(1.0);
    expect(candidates[0].objectiveId).toBe("obj-1");
    expect(candidates[0].title).toBe("Improve reliability");
    expect(candidates[1].score).toBe(1.0);
  });

  it("returns empty array for empty input", () => {
    expect(buildGraphTraversalCandidates([])).toHaveLength(0);
  });

  it("filters out inactive objectives (only active should be passed in)", () => {
    // The function receives pre-filtered rows, so all get score 1.0
    const graphRows = [{ objectiveId: "obj-1", title: "Active objective" }];
    const candidates = buildGraphTraversalCandidates(graphRows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// BM25 Candidates
// ---------------------------------------------------------------------------

describe("buildBm25Candidates", () => {
  it("normalizes BM25 scores and caps at ambiguous classification", () => {
    const bm25Rows = [
      { objectiveId: "obj-1", title: "Reliability goal", score: 8.5 },
      { objectiveId: "obj-2", title: "Another goal", score: 3.2 },
    ];
    const candidates = buildBm25Candidates(bm25Rows);
    expect(candidates).toHaveLength(2);
    // Highest raw score normalizes to the ambiguous range (capped below matched threshold)
    expect(candidates[0].score).toBeGreaterThan(0);
    expect(candidates[0].score).toBeLessThan(0.7); // never reaches "matched"
    expect(candidates[0].objectiveId).toBe("obj-1");
  });

  it("returns empty array for empty input", () => {
    expect(buildBm25Candidates([])).toHaveLength(0);
  });

  it("handles single result", () => {
    const bm25Rows = [{ objectiveId: "obj-1", title: "Only one", score: 5.0 }];
    const candidates = buildBm25Candidates(bm25Rows);
    expect(candidates).toHaveLength(1);
    // Single BM25 match normalizes to ambiguous range
    expect(candidates[0].score).toBeGreaterThan(0);
    expect(candidates[0].score).toBeLessThan(0.7);
  });

  it("preserves ordering by score descending", () => {
    const bm25Rows = [
      { objectiveId: "obj-1", title: "Low", score: 1.0 },
      { objectiveId: "obj-2", title: "High", score: 10.0 },
      { objectiveId: "obj-3", title: "Mid", score: 5.0 },
    ];
    const candidates = buildBm25Candidates(bm25Rows);
    expect(candidates[0].objectiveId).toBe("obj-2");
    expect(candidates[1].objectiveId).toBe("obj-3");
    expect(candidates[2].objectiveId).toBe("obj-1");
  });
});
