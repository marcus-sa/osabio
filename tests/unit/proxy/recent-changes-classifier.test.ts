/**
 * Unit tests for recent changes vector search classification
 *
 * Tests the pure classifier function that categorizes KNN results
 * by similarity threshold into urgent-context vs context-update,
 * and the XML builder for recent changes.
 *
 * Step: 04-01 (graph-reactive-coordination)
 */
import { describe, expect, it } from "bun:test";
import {
  classifyBySimilarity,
  buildRecentChangesXml,
  type RecentChangeCandidate,
  type ClassifiedChange,
} from "../../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// classifyBySimilarity
// ---------------------------------------------------------------------------

describe("classifyBySimilarity", () => {
  const makeCandidate = (
    similarity: number,
    overrides?: Partial<RecentChangeCandidate>,
  ): RecentChangeCandidate => ({
    id: `test-${crypto.randomUUID()}`,
    table: "decision",
    text: "Some change text",
    similarity,
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  it("classifies high similarity (>=0.7) as urgent-context", () => {
    const candidates = [makeCandidate(0.90)];
    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("urgent-context");
  });

  it("classifies moderate similarity (0.4-0.7) as context-update", () => {
    const candidates = [makeCandidate(0.55)];
    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("context-update");
  });

  it("filters out below threshold (<0.4) matches", () => {
    const candidates = [makeCandidate(0.35)];
    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(0);
  });

  it("handles boundary at 0.7 as urgent-context", () => {
    const candidates = [makeCandidate(0.70)];
    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("urgent-context");
  });

  it("handles boundary at 0.4 as context-update", () => {
    const candidates = [makeCandidate(0.40)];
    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("context-update");
  });

  it("returns empty array when no candidates match", () => {
    const candidates = [makeCandidate(0.30), makeCandidate(0.10)];
    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(0);
  });

  it("returns empty array for empty input", () => {
    const result = classifyBySimilarity([]);
    expect(result.length).toBe(0);
  });

  it("classifies mixed similarities correctly and preserves order", () => {
    const candidates = [
      makeCandidate(0.95, { table: "task", text: "urgent task" }),
      makeCandidate(0.55, { table: "observation", text: "moderate obs" }),
      makeCandidate(0.30, { table: "decision", text: "low decision" }),
      makeCandidate(0.88, { table: "decision", text: "urgent decision" }),
    ];

    const result = classifyBySimilarity(candidates);

    expect(result.length).toBe(3);
    expect(result[0].classification).toBe("urgent-context");
    expect(result[0].text).toBe("urgent task");
    expect(result[1].classification).toBe("context-update");
    expect(result[1].text).toBe("moderate obs");
    expect(result[2].classification).toBe("urgent-context");
    expect(result[2].text).toBe("urgent decision");
  });

  it("preserves candidate metadata in classified output", () => {
    const candidate = makeCandidate(0.90, {
      id: "dec-123",
      table: "decision",
      text: "Use tRPC for all APIs",
      updatedAt: "2026-03-17T10:00:00Z",
    });

    const result = classifyBySimilarity([candidate]);

    expect(result[0].id).toBe("dec-123");
    expect(result[0].table).toBe("decision");
    expect(result[0].text).toBe("Use tRPC for all APIs");
    expect(result[0].similarity).toBe(0.90);
    expect(result[0].updatedAt).toBe("2026-03-17T10:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// buildRecentChangesXml
// ---------------------------------------------------------------------------

describe("buildRecentChangesXml", () => {
  const makeClassified = (
    classification: "urgent-context" | "context-update",
    overrides?: Partial<ClassifiedChange>,
  ): ClassifiedChange => ({
    id: `test-${crypto.randomUUID()}`,
    table: "decision",
    text: "Some change",
    similarity: classification === "urgent-context" ? 0.90 : 0.75,
    updatedAt: new Date().toISOString(),
    classification,
    ...overrides,
  });

  it("returns empty string when no changes", () => {
    expect(buildRecentChangesXml([])).toBe("");
  });

  it("builds XML with urgent-context section", () => {
    const changes = [
      makeClassified("urgent-context", { table: "decision", text: "Use GraphQL" }),
    ];

    const xml = buildRecentChangesXml(changes);

    expect(xml).toContain("<recent-changes>");
    expect(xml).toContain("<urgent-context>");
    expect(xml).toContain("Use GraphQL");
    expect(xml).toContain("</urgent-context>");
    expect(xml).toContain("</recent-changes>");
  });

  it("builds XML with context-update section", () => {
    const changes = [
      makeClassified("context-update", { table: "task", text: "Implement auth" }),
    ];

    const xml = buildRecentChangesXml(changes);

    expect(xml).toContain("<context-update>");
    expect(xml).toContain("Implement auth");
    expect(xml).toContain("</context-update>");
  });

  it("includes entity type in items", () => {
    const changes = [
      makeClassified("urgent-context", { table: "decision", text: "Use tRPC" }),
    ];

    const xml = buildRecentChangesXml(changes);

    expect(xml).toContain("decision");
    expect(xml).toContain("Use tRPC");
  });

  it("separates urgent-context and context-update into distinct sections", () => {
    const changes = [
      makeClassified("urgent-context", { text: "Urgent change" }),
      makeClassified("context-update", { text: "Background update" }),
    ];

    const xml = buildRecentChangesXml(changes);

    expect(xml).toContain("<urgent-context>");
    expect(xml).toContain("Urgent change");
    expect(xml).toContain("<context-update>");
    expect(xml).toContain("Background update");
  });
});
