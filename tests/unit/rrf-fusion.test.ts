/**
 * Unit tests for Reciprocal Rank Fusion (RRF) — pure function tests.
 *
 * RRF_score(d) = Σ 1 / (k + rank_i(d))
 * where rank_i(d) is 1-based rank of document d in list i.
 */
import { describe, test, expect } from "bun:test";
import { applyRrf, type RrfItem } from "../../app/src/server/graph/bm25-search";

// Helper to create RRF items with minimal boilerplate
function item<T extends Record<string, unknown>>(key: string, data: T): RrfItem<T> {
  return { _rrfKey: key, ...data };
}

describe("applyRrf", () => {
  test("returns empty array for empty input lists", () => {
    expect(applyRrf([], 10)).toEqual([]);
  });

  test("returns empty array when all lists are empty", () => {
    expect(applyRrf([[], [], []], 10)).toEqual([]);
  });

  test("single list preserves original ranking order", () => {
    const list = [
      item("a", { name: "Alpha" }),
      item("b", { name: "Beta" }),
      item("c", { name: "Gamma" }),
    ];

    const result = applyRrf([list], 10);

    expect(result.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("single list computes correct RRF scores with k=60", () => {
    const list = [
      item("a", { name: "Alpha" }),
      item("b", { name: "Beta" }),
    ];

    const result = applyRrf([list], 10, 60);

    // rank 1 → 1/(60+1) ≈ 0.01639
    // rank 2 → 1/(60+2) ≈ 0.01613
    expect(result[0].rrfScore).toBeCloseTo(1 / 61, 10);
    expect(result[1].rrfScore).toBeCloseTo(1 / 62, 10);
  });

  test("fuses two lists — item appearing in both gets summed score", () => {
    const list1 = [
      item("a", { name: "Alpha" }),
      item("b", { name: "Beta" }),
    ];
    const list2 = [
      item("b", { name: "Beta" }),
      item("c", { name: "Gamma" }),
    ];

    const result = applyRrf([list1, list2], 10, 60);

    // "b" appears rank 2 in list1 + rank 1 in list2 → 1/62 + 1/61
    // "a" appears rank 1 in list1 only → 1/61
    // "c" appears rank 2 in list2 only → 1/62
    const bScore = 1 / 62 + 1 / 61;
    const aScore = 1 / 61;
    const cScore = 1 / 62;

    expect(result[0].name).toBe("Beta"); // highest fused score
    expect(result[0].rrfScore).toBeCloseTo(bScore, 10);
    expect(result[1].name).toBe("Alpha");
    expect(result[1].rrfScore).toBeCloseTo(aScore, 10);
    expect(result[2].name).toBe("Gamma");
    expect(result[2].rrfScore).toBeCloseTo(cScore, 10);
  });

  test("respects limit parameter", () => {
    const list = [
      item("a", { v: 1 }),
      item("b", { v: 2 }),
      item("c", { v: 3 }),
      item("d", { v: 4 }),
    ];

    const result = applyRrf([list], 2);
    expect(result).toHaveLength(2);
    expect(result[0].v).toBe(1);
    expect(result[1].v).toBe(2);
  });

  test("cross-table fusion ranks by position not raw score", () => {
    // Simulates the core issue: table A has high BM25 scores, table B has low ones.
    // With raw score concat, table A dominates. RRF normalizes by rank.
    const tableA = [
      item("task:1", { kind: "task", bm25: 8.5 }),
      item("task:2", { kind: "task", bm25: 7.2 }),
    ];
    const tableB = [
      item("decision:1", { kind: "decision", bm25: 1.8 }),
      item("decision:2", { kind: "decision", bm25: 1.2 }),
    ];

    const result = applyRrf([tableA, tableB], 4, 60);

    // Both rank-1 items should tie (each gets 1/61)
    // Both rank-2 items should tie (each gets 1/62)
    expect(result[0].rrfScore).toBeCloseTo(result[1].rrfScore, 10);
    expect(result[2].rrfScore).toBeCloseTo(result[3].rrfScore, 10);

    // The BM25 scores should NOT influence the RRF ranking
    // (both rank-1s are tied, both rank-2s are tied)
    const rank1Scores = result.slice(0, 2).map((r) => r.rrfScore);
    const rank2Scores = result.slice(2, 4).map((r) => r.rrfScore);
    expect(rank1Scores[0]).toBeGreaterThan(rank2Scores[0]);
  });

  test("three-way fusion across heterogeneous table sizes", () => {
    const tasks = [
      item("task:1", { name: "Task 1" }),
      item("task:2", { name: "Task 2" }),
      item("task:3", { name: "Task 3" }),
    ];
    const decisions = [
      item("dec:1", { name: "Decision 1" }),
    ];
    const features = [
      item("feat:1", { name: "Feature 1" }),
      item("feat:2", { name: "Feature 2" }),
    ];

    const result = applyRrf([tasks, decisions, features], 10, 60);

    // All three rank-1 items share the same RRF score: 1/61
    const rank1Items = result.filter((r) => r.rrfScore === result[0].rrfScore);
    expect(rank1Items).toHaveLength(3);
  });

  test("custom k parameter changes score distribution", () => {
    const list = [
      item("a", { v: "a" }),
      item("b", { v: "b" }),
    ];

    const withK1 = applyRrf([list], 10, 1);
    const withK60 = applyRrf([list], 10, 60);

    // With k=1: rank1 = 1/2 = 0.5, rank2 = 1/3 ≈ 0.333
    // With k=60: rank1 = 1/61 ≈ 0.0164, rank2 = 1/62 ≈ 0.0161
    // Low k amplifies rank differences; high k dampens them
    const gapK1 = withK1[0].rrfScore - withK1[1].rrfScore;
    const gapK60 = withK60[0].rrfScore - withK60[1].rrfScore;
    expect(gapK1).toBeGreaterThan(gapK60);
  });

  test("strips _rrfKey from output items", () => {
    const list = [item("a", { name: "Alpha" })];
    const result = applyRrf([list], 10);

    expect(result[0]).toHaveProperty("name", "Alpha");
    expect(result[0]).toHaveProperty("rrfScore");
    expect(result[0]).not.toHaveProperty("_rrfKey");
  });

  test("handles duplicate keys across lists by summing contributions", () => {
    // Same item ranked #1 in all three lists
    const list1 = [item("x", { name: "X" })];
    const list2 = [item("x", { name: "X" })];
    const list3 = [item("x", { name: "X" })];

    const result = applyRrf([list1, list2, list3], 10, 60);

    expect(result).toHaveLength(1);
    expect(result[0].rrfScore).toBeCloseTo(3 / 61, 10);
  });
});
