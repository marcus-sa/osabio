import { describe, expect, it } from "bun:test";
import { classifyDedupSimilarity, pickRicherEntityName } from "../../app/src/server/extraction/dedup";

describe("dedup thresholds", () => {
  it("auto-merges over 0.95 similarity and keeps richer name", () => {
    expect(classifyDedupSimilarity(0.96)).toBe("merge");
    expect(pickRicherEntityName("Use TypeScript", "Use TypeScript over Rust for the backend")).toBe(
      "Use TypeScript over Rust for the backend",
    );
  });

  it("marks 0.80-0.95 as possible duplicates", () => {
    expect(classifyDedupSimilarity(0.8)).toBe("possible_duplicate");
    expect(classifyDedupSimilarity(0.95)).toBe("possible_duplicate");
  });

  it("keeps low-similarity entities independent", () => {
    expect(classifyDedupSimilarity(0.79)).toBe("independent");
  });

  it("prefers descriptive names across entity kinds", () => {
    expect(pickRicherEntityName("tax platform", "forensic tax calculation platform for CARF compliance")).toBe(
      "forensic tax calculation platform for CARF compliance",
    );
    expect(pickRicherEntityName("set up DB", "set up SurrealDB schema with HNSW vector index")).toBe(
      "set up SurrealDB schema with HNSW vector index",
    );
  });
});
