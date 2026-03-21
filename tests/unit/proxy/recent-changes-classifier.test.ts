/**
 * Unit tests for recent changes classification and XML building
 *
 * Tests the pure classifier function that categorizes candidates
 * by age into urgent-context vs context-update tiers,
 * and the XML builder for recent changes.
 *
 * Originally: 04-01 (similarity-based). Updated: 02-02 (time-based via classifyByAge).
 */
import { describe, expect, it } from "bun:test";
import {
  classifyByAge,
  buildRecentChangesXml,
  type RecentChangeCandidate,
  type ClassifiedChange,
} from "../../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// classifyByAge (replaces classifyBySimilarity)
// ---------------------------------------------------------------------------

describe("classifyByAge", () => {
  const now = new Date("2026-03-20T12:00:00Z");

  const makeCandidate = (
    minutesOld: number,
    overrides?: Partial<RecentChangeCandidate>,
  ): RecentChangeCandidate => ({
    id: `test-${crypto.randomUUID()}`,
    table: "decision",
    text: "Some change text",
    similarity: 0,
    updatedAt: new Date(now.getTime() - minutesOld * 60 * 1000).toISOString(),
    ...overrides,
  });

  it("classifies item updated <30min ago as urgent-context", () => {
    const candidates = [makeCandidate(10)];
    const result = classifyByAge(candidates, now);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("urgent-context");
  });

  it("classifies item updated 30min-24h ago as context-update", () => {
    const candidates = [makeCandidate(120)]; // 2 hours
    const result = classifyByAge(candidates, now);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("context-update");
  });

  it("filters out items older than 24 hours", () => {
    const candidates = [makeCandidate(25 * 60)]; // 25 hours
    const result = classifyByAge(candidates, now);

    expect(result.length).toBe(0);
  });

  it("handles boundary at 30 minutes as urgent-context", () => {
    const candidates = [makeCandidate(30)];
    const result = classifyByAge(candidates, now);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("urgent-context");
  });

  it("handles boundary at 24 hours as context-update", () => {
    const candidates = [makeCandidate(24 * 60)];
    const result = classifyByAge(candidates, now);

    expect(result.length).toBe(1);
    expect(result[0].classification).toBe("context-update");
  });

  it("returns empty array for empty input", () => {
    const result = classifyByAge([], now);
    expect(result.length).toBe(0);
  });

  it("classifies mixed ages correctly and preserves order", () => {
    const candidates = [
      makeCandidate(5, { table: "task", text: "urgent task" }),
      makeCandidate(120, { table: "observation", text: "recent obs" }),
      makeCandidate(30 * 60, { table: "decision", text: "old decision" }),
      makeCandidate(15, { table: "decision", text: "urgent decision" }),
    ];

    const result = classifyByAge(candidates, now);

    expect(result.length).toBe(3);
    expect(result[0].classification).toBe("urgent-context");
    expect(result[0].text).toBe("urgent task");
    expect(result[1].classification).toBe("context-update");
    expect(result[1].text).toBe("recent obs");
    expect(result[2].classification).toBe("urgent-context");
    expect(result[2].text).toBe("urgent decision");
  });

  it("preserves candidate metadata in classified output", () => {
    const candidate = makeCandidate(10, {
      id: "dec-123",
      table: "decision",
      text: "Use tRPC for all APIs",
    });

    const result = classifyByAge([candidate], now);

    expect(result[0].id).toBe("dec-123");
    expect(result[0].table).toBe("decision");
    expect(result[0].text).toBe("Use tRPC for all APIs");
    expect(result[0].updatedAt).toBe(candidate.updatedAt);
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
    similarity: 0,
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
