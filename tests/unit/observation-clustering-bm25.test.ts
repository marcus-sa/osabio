/**
 * Unit tests: BM25-based observation clustering for learning diagnosis.
 *
 * Tests pure functions that:
 *   - Build BM25 similarity queries for observation text matching
 *   - Group observations into clusters from BM25 similarity results
 *   - Pick representative text from a cluster
 *
 * No IO -- these functions take observation data and return cluster decisions.
 */
import { describe, test, expect } from "bun:test";
import {
  buildObservationSimilarityQuery,
  extractSearchTerms,
  groupObservationsIntoClusters,
  type ObservationForClustering,
  type Bm25SimilarityEdge,
} from "../../app/src/server/observer/learning-diagnosis";

// ---------------------------------------------------------------------------
// buildObservationSimilarityQuery: pure SQL construction
// ---------------------------------------------------------------------------

describe("buildObservationSimilarityQuery", () => {
  test("builds BM25 query with bound $query param and workspace filter", () => {
    const sql = buildObservationSimilarityQuery();
    expect(sql).toContain("@1@ $query");
    expect(sql).toContain("workspace = $ws");
    expect(sql).toContain("search::score(1)");
    expect(sql).toContain("FROM observation");
  });

  test("does not use string literal interpolation", () => {
    const sql = buildObservationSimilarityQuery();
    expect(sql).not.toMatch(/@1@ '/);
  });

  test("filters to open/acknowledged status observations", () => {
    const sql = buildObservationSimilarityQuery();
    expect(sql).toContain("open");
    expect(sql).toContain("acknowledged");
  });
});

// ---------------------------------------------------------------------------
// extractSearchTerms: key term extraction for BM25 queries
// ---------------------------------------------------------------------------

describe("extractSearchTerms", () => {
  test("extracts key terms dropping stopwords", () => {
    const terms = extractSearchTerms("deployment failure in production environment");
    expect(terms).toContain("deployment");
    expect(terms).toContain("failure");
    expect(terms).toContain("production");
    expect(terms).not.toContain("in");
  });

  test("strips non-alpha characters", () => {
    const terms = extractSearchTerms("the system can't deploy on Fridays properly");
    expect(terms).toContain("deploy");
    expect(terms).toContain("fridays");
    // Single quote removed by term extraction
    expect(terms).not.toContain("'");
  });
});

// ---------------------------------------------------------------------------
// groupObservationsIntoClusters: pure clustering from BM25 edges
// ---------------------------------------------------------------------------

describe("groupObservationsIntoClusters", () => {
  const makeObs = (id: string, text: string): ObservationForClustering => ({
    id,
    text,
    severity: "warning",
    entityRefs: [],
  });

  test("returns empty clusters when fewer observations than minimum cluster size", () => {
    const observations = [makeObs("a", "text a"), makeObs("b", "text b")];
    const edges: Bm25SimilarityEdge[] = [
      { sourceId: "a", matchId: "b", score: 2.0 },
    ];
    const clusters = groupObservationsIntoClusters(observations, edges, 3);
    expect(clusters).toEqual([]);
  });

  test("groups connected observations into a cluster", () => {
    const observations = [
      makeObs("a", "deployment failure in production"),
      makeObs("b", "deployment failure during release"),
      makeObs("c", "production deployment failure detected"),
    ];
    // a<->b, b<->c => all connected
    const edges: Bm25SimilarityEdge[] = [
      { sourceId: "a", matchId: "b", score: 2.5 },
      { sourceId: "a", matchId: "c", score: 1.8 },
      { sourceId: "b", matchId: "c", score: 2.1 },
    ];

    const clusters = groupObservationsIntoClusters(observations, edges, 3);
    expect(clusters.length).toBe(1);
    expect(clusters[0].clusterSize).toBe(3);
    expect(clusters[0].observations.map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
  });

  test("separates disconnected groups into distinct clusters", () => {
    const observations = [
      makeObs("a", "deployment failure"),
      makeObs("b", "deployment error"),
      makeObs("c", "deployment issue"),
      makeObs("x", "memory leak detected"),
      makeObs("y", "memory leak in service"),
      makeObs("z", "memory leak warning"),
    ];
    // Group 1: a-b-c, Group 2: x-y-z, no cross-group edges
    const edges: Bm25SimilarityEdge[] = [
      { sourceId: "a", matchId: "b", score: 2.0 },
      { sourceId: "a", matchId: "c", score: 1.5 },
      { sourceId: "b", matchId: "c", score: 1.8 },
      { sourceId: "x", matchId: "y", score: 2.2 },
      { sourceId: "x", matchId: "z", score: 1.9 },
      { sourceId: "y", matchId: "z", score: 2.0 },
    ];

    const clusters = groupObservationsIntoClusters(observations, edges, 3);
    expect(clusters.length).toBe(2);
    expect(clusters.every((c) => c.clusterSize === 3)).toBe(true);
  });

  test("picks representative text as the observation with highest total BM25 score", () => {
    const observations = [
      makeObs("a", "deployment failure one"),
      makeObs("b", "deployment failure two"),
      makeObs("c", "deployment failure three"),
    ];
    // b has the highest total score (3.0 + 2.5 = 5.5)
    const edges: Bm25SimilarityEdge[] = [
      { sourceId: "a", matchId: "b", score: 3.0 },
      { sourceId: "a", matchId: "c", score: 1.0 },
      { sourceId: "b", matchId: "c", score: 2.5 },
    ];

    const clusters = groupObservationsIntoClusters(observations, edges, 3);
    expect(clusters[0].representativeText).toBe("deployment failure two");
  });

  test("observations with no edges are not clustered", () => {
    const observations = [
      makeObs("a", "topic alpha"),
      makeObs("b", "topic beta"),
      makeObs("c", "topic gamma"),
    ];
    const edges: Bm25SimilarityEdge[] = [];

    const clusters = groupObservationsIntoClusters(observations, edges, 3);
    expect(clusters).toEqual([]);
  });
});
