/**
 * Unit Tests: Time-Based Recent Changes (Step 02-03)
 *
 * Pure function tests for replacing BM25-based recent changes search
 * with time-ordered SurrealDB queries filtered by workspace and updated_at.
 *
 * Behaviors tested:
 * 1. buildTimeWindowCutoff: computes cutoff Date from now and window duration
 * 2. mapRowsToRecentChanges: transforms DB rows to RecentChangeCandidate[]
 */
import { describe, expect, it } from "bun:test";
import {
  buildTimeWindowCutoff,
  mapRowsToRecentChanges,
  type TimeBasedChangeRow,
} from "../../app/src/server/proxy/context-injector";

// ---------------------------------------------------------------------------
// buildTimeWindowCutoff: pure Date arithmetic
// ---------------------------------------------------------------------------
describe("buildTimeWindowCutoff", () => {
  const now = new Date("2026-03-20T12:00:00Z");

  it("computes cutoff as now minus window duration in milliseconds", () => {
    const oneHourMs = 60 * 60 * 1000;
    const cutoff = buildTimeWindowCutoff(now, oneHourMs);
    expect(cutoff.toISOString()).toBe("2026-03-20T11:00:00.000Z");
  });

  it("computes cutoff for 24-hour window", () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const cutoff = buildTimeWindowCutoff(now, oneDayMs);
    expect(cutoff.toISOString()).toBe("2026-03-19T12:00:00.000Z");
  });

  it("returns now when window is zero", () => {
    const cutoff = buildTimeWindowCutoff(now, 0);
    expect(cutoff.toISOString()).toBe(now.toISOString());
  });
});

// ---------------------------------------------------------------------------
// mapRowsToRecentChanges: transform DB rows to domain candidates
// ---------------------------------------------------------------------------
describe("mapRowsToRecentChanges", () => {
  it("maps decision rows with correct table and text field", () => {
    const rows: TimeBasedChangeRow[] = [
      { id: "abc-123", text: "Use tRPC for all APIs", updated_at: "2026-03-20T11:30:00Z" },
    ];

    const result = mapRowsToRecentChanges(rows, "decision");

    expect(result).toEqual([
      {
        id: "abc-123",
        table: "decision",
        text: "Use tRPC for all APIs",
        similarity: 1.0,
        updatedAt: "2026-03-20T11:30:00Z",
      },
    ]);
  });

  it("maps task rows with correct table", () => {
    const rows: TimeBasedChangeRow[] = [
      { id: "task-1", text: "Implement rate limiting", updated_at: "2026-03-20T10:00:00Z" },
    ];

    const result = mapRowsToRecentChanges(rows, "task");

    expect(result[0].table).toBe("task");
  });

  it("maps observation rows with correct table", () => {
    const rows: TimeBasedChangeRow[] = [
      { id: "obs-1", text: "Auth drift detected", updated_at: "2026-03-20T09:00:00Z" },
    ];

    const result = mapRowsToRecentChanges(rows, "observation");

    expect(result[0].table).toBe("observation");
  });

  it("returns empty array for empty input", () => {
    const result = mapRowsToRecentChanges([], "decision");
    expect(result).toEqual([]);
  });

  it("preserves order from input rows", () => {
    const rows: TimeBasedChangeRow[] = [
      { id: "first", text: "Newer", updated_at: "2026-03-20T11:00:00Z" },
      { id: "second", text: "Older", updated_at: "2026-03-20T10:00:00Z" },
    ];

    const result = mapRowsToRecentChanges(rows, "decision");

    expect(result[0].id).toBe("first");
    expect(result[1].id).toBe("second");
  });
});
