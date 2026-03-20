/**
 * Unit Tests: BM25 + Recency Context Ranking (Step 02-01)
 *
 * Pure function tests for replacing cosine similarity with BM25 score
 * weighted by recency decay: finalScore = bm25Score * decayFactor
 * where decayFactor = exp(-ageHours / halflife)
 */
import { describe, expect, it } from "bun:test";
import {
  computeRecencyDecay,
  computeFinalScore,
  rankByBm25WithRecency,
  type Bm25ContextCandidate,
} from "../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// computeRecencyDecay: exponential decay by age
// ---------------------------------------------------------------------------
describe("computeRecencyDecay", () => {
  it("returns 1.0 for zero age (just updated)", () => {
    const decay = computeRecencyDecay(0, 168);
    expect(decay).toBe(1.0);
  });

  it("returns ~0.5 at exactly one half-life", () => {
    const halflife = 168; // one week in hours
    const decay = computeRecencyDecay(halflife, halflife);
    // exp(-1) ~= 0.368, not exactly 0.5
    // For true half-life semantics: decay = exp(-age * ln(2) / halflife)
    // But spec says exp(-age / halflife), so at age=halflife: exp(-1) ~= 0.368
    expect(decay).toBeCloseTo(Math.exp(-1), 5);
  });

  it("returns value approaching 0 for very old items", () => {
    const decay = computeRecencyDecay(10000, 168);
    expect(decay).toBeLessThan(0.001);
    expect(decay).toBeGreaterThan(0);
  });

  it("returns 1.0 for negative age (future timestamp treated as fresh)", () => {
    const decay = computeRecencyDecay(-5, 168);
    expect(decay).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// computeFinalScore: BM25 * recency decay
// ---------------------------------------------------------------------------
describe("computeFinalScore", () => {
  const now = new Date("2026-03-20T12:00:00Z");

  it("multiplies BM25 score by recency decay factor", () => {
    const oneHourAgo = new Date("2026-03-20T11:00:00Z");
    const score = computeFinalScore(2.5, oneHourAgo.toISOString(), now, 168);
    const expectedDecay = Math.exp(-1 / 168);
    expect(score).toBeCloseTo(2.5 * expectedDecay, 5);
  });

  it("returns full BM25 score for items updated at exactly now", () => {
    const score = computeFinalScore(3.0, now.toISOString(), now, 168);
    expect(score).toBeCloseTo(3.0, 5);
  });

  it("recently updated items score higher than stale items at equal BM25 relevance", () => {
    const recent = new Date("2026-03-20T11:00:00Z"); // 1 hour ago
    const stale = new Date("2026-03-13T12:00:00Z");  // 7 days ago (168 hours)

    const recentScore = computeFinalScore(2.0, recent.toISOString(), now, 168);
    const staleScore = computeFinalScore(2.0, stale.toISOString(), now, 168);

    expect(recentScore).toBeGreaterThan(staleScore);
  });
});

// ---------------------------------------------------------------------------
// rankByBm25WithRecency: combined ranking pipeline
// ---------------------------------------------------------------------------
describe("rankByBm25WithRecency", () => {
  const now = new Date("2026-03-20T12:00:00Z");

  function makeCandidate(overrides: Partial<Bm25ContextCandidate>): Bm25ContextCandidate {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      type: overrides.type ?? "decision",
      text: overrides.text ?? "Some context item",
      bm25Score: overrides.bm25Score ?? 1.0,
      updatedAt: overrides.updatedAt ?? now.toISOString(),
    };
  }

  it("ranks items by combined BM25 relevance and recency", () => {
    const candidates: Bm25ContextCandidate[] = [
      makeCandidate({ id: "stale-high-bm25", bm25Score: 3.0, updatedAt: "2026-03-06T12:00:00Z" }), // 14 days old
      makeCandidate({ id: "recent-mid-bm25", bm25Score: 2.0, updatedAt: "2026-03-20T11:00:00Z" }), // 1 hour old
      makeCandidate({ id: "recent-high-bm25", bm25Score: 3.0, updatedAt: "2026-03-20T11:00:00Z" }), // 1 hour old
    ];

    const ranked = rankByBm25WithRecency(candidates, now, 168);

    expect(ranked[0].id).toBe("recent-high-bm25");
    expect(ranked[1].id).toBe("recent-mid-bm25");
    // Stale high-BM25 item decayed significantly (14 days / 168h halflife = exp(-2) ~= 0.135)
    // 3.0 * 0.135 ~= 0.405 vs 2.0 * ~1.0 ~= 2.0
    expect(ranked[2].id).toBe("stale-high-bm25");
  });

  it("returns empty array for empty candidates", () => {
    const ranked = rankByBm25WithRecency([], now, 168);
    expect(ranked).toEqual([]);
  });

  it("preserves type information in ranked output", () => {
    const candidates: Bm25ContextCandidate[] = [
      makeCandidate({ type: "learning", bm25Score: 2.0 }),
      makeCandidate({ type: "observation", bm25Score: 1.5 }),
      makeCandidate({ type: "decision", bm25Score: 1.0 }),
    ];

    const ranked = rankByBm25WithRecency(candidates, now, 168);

    expect(ranked.map((r) => r.type)).toEqual(["learning", "observation", "decision"]);
  });

  it("all scores are non-negative", () => {
    const candidates: Bm25ContextCandidate[] = [
      makeCandidate({ bm25Score: 0, updatedAt: "2020-01-01T00:00:00Z" }),
      makeCandidate({ bm25Score: 1.0 }),
    ];

    const ranked = rankByBm25WithRecency(candidates, now, 168);

    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});
