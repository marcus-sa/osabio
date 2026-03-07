import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../../../app/src/client/components/review/AgentActivityLog";

describe("ActivityEntry type contract", () => {
  it("represents a tool_call entry", () => {
    const entry: ActivityEntry = {
      timestamp: "2026-03-07T10:00:00Z",
      type: "tool_call",
      description: "Read file src/main.ts",
    };
    expect(entry.type).toBe("tool_call");
    expect(entry.timestamp).toBeDefined();
    expect(entry.description).toBeDefined();
  });

  it("represents a file_change entry", () => {
    const entry: ActivityEntry = {
      timestamp: "2026-03-07T10:01:00Z",
      type: "file_change",
      description: "Modified src/server.ts",
    };
    expect(entry.type).toBe("file_change");
  });

  it("represents a decision entry", () => {
    const entry: ActivityEntry = {
      timestamp: "2026-03-07T10:02:00Z",
      type: "decision",
      description: "Chose PostgreSQL adapter over SQLite",
    };
    expect(entry.type).toBe("decision");
  });

  it("represents an error entry", () => {
    const entry: ActivityEntry = {
      timestamp: "2026-03-07T10:03:00Z",
      type: "error",
      description: "Build failed: type mismatch in config.ts",
    };
    expect(entry.type).toBe("error");
  });

  it("entries sort chronologically by timestamp", () => {
    const entries: ActivityEntry[] = [
      { timestamp: "2026-03-07T10:02:00Z", type: "decision", description: "Second" },
      { timestamp: "2026-03-07T10:00:00Z", type: "tool_call", description: "First" },
      { timestamp: "2026-03-07T10:05:00Z", type: "file_change", description: "Third" },
    ];
    const sorted = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    expect(sorted.map((e) => e.description)).toEqual(["First", "Second", "Third"]);
  });
});
