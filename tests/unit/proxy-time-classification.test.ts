/**
 * Unit Tests: Time-based Context Classification (Step 02-02)
 *
 * Pure function tests for classifying context items by age:
 * - Items updated within 30 minutes -> "urgent-context"
 * - Items updated within 24 hours -> "context-update"
 * - Items older than 24 hours -> filtered out
 */
import { describe, expect, it } from "bun:test";
import {
  classifyByAge,
  type RecentChangeCandidate,
  type ClassifiedChange,
} from "../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// Test Data Factory
// ---------------------------------------------------------------------------

function makeChangeCandidate(
  overrides: Partial<RecentChangeCandidate> = {},
): RecentChangeCandidate {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    table: overrides.table ?? "decision",
    text: overrides.text ?? "Use TypeScript for all new services",
    similarity: overrides.similarity ?? 0,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// classifyByAge: time-based classification tiers
// ---------------------------------------------------------------------------

describe("classifyByAge", () => {
  const now = new Date("2026-03-20T12:00:00Z");

  it("classifies item updated 15 minutes ago as urgent-context", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: minutesAgo(now, 15) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("urgent-context");
  });

  it("classifies item updated exactly at now as urgent-context", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: now.toISOString() }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("urgent-context");
  });

  it("classifies item updated 29 minutes ago as urgent-context", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: minutesAgo(now, 29) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("urgent-context");
  });

  it("classifies item updated 31 minutes ago as context-update", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: minutesAgo(now, 31) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("context-update");
  });

  it("classifies item updated 12 hours ago as context-update", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: hoursAgo(now, 12) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("context-update");
  });

  it("classifies item updated 23 hours ago as context-update", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: hoursAgo(now, 23) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("context-update");
  });

  it("filters out items older than 24 hours", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: hoursAgo(now, 25) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(0);
  });

  it("classifies mixed-age items into correct tiers", () => {
    const candidates = [
      makeChangeCandidate({ id: "urgent", updatedAt: minutesAgo(now, 10) }),
      makeChangeCandidate({ id: "recent", updatedAt: hoursAgo(now, 6) }),
      makeChangeCandidate({ id: "old", updatedAt: hoursAgo(now, 48) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(2);
    const urgent = classified.find((c) => c.id === "urgent");
    const recent = classified.find((c) => c.id === "recent");
    expect(urgent?.classification).toBe("urgent-context");
    expect(recent?.classification).toBe("context-update");
    expect(classified.find((c) => c.id === "old")).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    const classified = classifyByAge([], now);
    expect(classified).toHaveLength(0);
  });

  it("preserves all candidate fields in output", () => {
    const candidate = makeChangeCandidate({
      id: "d1",
      table: "task",
      text: "Implement rate limiting",
      updatedAt: minutesAgo(now, 5),
      similarity: 3.5,
    });

    const classified = classifyByAge([candidate], now);

    expect(classified[0].id).toBe("d1");
    expect(classified[0].table).toBe("task");
    expect(classified[0].text).toBe("Implement rate limiting");
    expect(classified[0].updatedAt).toBe(candidate.updatedAt);
    expect(classified[0].similarity).toBe(3.5);
  });

  it("handles boundary at exactly 30 minutes as urgent-context", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: minutesAgo(now, 30) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("urgent-context");
  });

  it("handles boundary at exactly 24 hours as context-update", () => {
    const candidates = [
      makeChangeCandidate({ updatedAt: hoursAgo(now, 24) }),
    ];

    const classified = classifyByAge(candidates, now);

    expect(classified).toHaveLength(1);
    expect(classified[0].classification).toBe("context-update");
  });
});
