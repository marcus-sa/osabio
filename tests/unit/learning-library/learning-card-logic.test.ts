/**
 * Unit tests for LearningCard / LearningList / AgentChips pure logic.
 *
 * Tests the pure functions that drive the learning card components:
 * agent label resolution, card action computation, text truncation,
 * and status-based filtering.
 */
import { describe, expect, it } from "bun:test";
import {
  resolveAgentLabel,
  resolveAgentLabels,
  computeCardActions,
  truncateText,
  filterLearningsByStatus,
  TRUNCATION_THRESHOLD,
} from "../../../app/src/client/components/learning/learning-card-logic";
import type { LearningSummary } from "../../../app/src/shared/contracts";

// --- Test data factory ---

function makeLearning(overrides: Partial<LearningSummary> = {}): LearningSummary {
  return {
    id: "test-1",
    text: "Always use strict mode in TypeScript",
    learningType: "constraint",
    status: "active",
    source: "human",
    priority: "medium",
    targetAgents: ["chat_agent"],
    createdAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

// --- resolveAgentLabel ---

describe("resolveAgentLabel", () => {
  it("returns the human-readable label for a known agent value", () => {
    expect(resolveAgentLabel("chat_agent")).toBe("Chat Agent");
    expect(resolveAgentLabel("pm_agent")).toBe("PM Agent");
    expect(resolveAgentLabel("observer_agent")).toBe("Observer Agent");
    expect(resolveAgentLabel("mcp")).toBe("MCP (Coding Agents)");
  });

  it("returns the raw value for an unknown agent", () => {
    expect(resolveAgentLabel("custom_agent")).toBe("custom_agent");
  });
});

// --- resolveAgentLabels ---

describe("resolveAgentLabels", () => {
  it("returns 'All agents' for an empty target agents array", () => {
    expect(resolveAgentLabels([])).toEqual(["All agents"]);
  });

  it("maps each agent value to its label", () => {
    const result = resolveAgentLabels(["chat_agent", "pm_agent"]);
    expect(result).toEqual(["Chat Agent", "PM Agent"]);
  });

  it("preserves unknown agent values as-is", () => {
    const result = resolveAgentLabels(["chat_agent", "unknown"]);
    expect(result).toEqual(["Chat Agent", "unknown"]);
  });
});

// --- computeCardActions ---

describe("computeCardActions", () => {
  it("returns approve and dismiss actions for pending_approval status", () => {
    const actions = computeCardActions("pending_approval");
    expect(actions).toEqual([
      { action: "approve", label: "Approve" },
      { action: "dismiss", label: "Dismiss" },
    ]);
  });

  it("returns edit and deactivate actions for active status", () => {
    const actions = computeCardActions("active");
    expect(actions).toEqual([
      { action: "edit", label: "Edit" },
      { action: "deactivate", label: "Deactivate" },
    ]);
  });

  it("returns empty actions for dismissed status", () => {
    const actions = computeCardActions("dismissed");
    expect(actions).toEqual([]);
  });

  it("returns empty actions for deactivated status", () => {
    const actions = computeCardActions("deactivated");
    expect(actions).toEqual([]);
  });
});

// --- truncateText ---

describe("truncateText", () => {
  it("returns the full text when shorter than threshold", () => {
    const short = "Short text";
    expect(truncateText(short)).toBe(short);
  });

  it("truncates text exceeding the threshold and appends ellipsis", () => {
    const long = "A".repeat(TRUNCATION_THRESHOLD + 50);
    const result = truncateText(long);
    expect(result.length).toBeLessThanOrEqual(TRUNCATION_THRESHOLD + 3); // +3 for "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not truncate text exactly at the threshold", () => {
    const exact = "B".repeat(TRUNCATION_THRESHOLD);
    expect(truncateText(exact)).toBe(exact);
  });
});

// --- filterLearningsByStatus ---

describe("filterLearningsByStatus", () => {
  const learnings: LearningSummary[] = [
    makeLearning({ id: "1", status: "active" }),
    makeLearning({ id: "2", status: "pending_approval" }),
    makeLearning({ id: "3", status: "active" }),
    makeLearning({ id: "4", status: "dismissed", dismissedAt: "2026-03-02T00:00:00Z", dismissedReason: "outdated" }),
    makeLearning({ id: "5", status: "deactivated", deactivatedAt: "2026-03-02T00:00:00Z" }),
  ];

  it("filters learnings to only the specified status", () => {
    const active = filterLearningsByStatus(learnings, "active");
    expect(active).toHaveLength(2);
    expect(active.every((l) => l.status === "active")).toBe(true);
  });

  it("returns pending learnings when filtered by pending_approval", () => {
    const pending = filterLearningsByStatus(learnings, "pending_approval");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("2");
  });

  it("returns empty array when no learnings match the status", () => {
    const superseded = filterLearningsByStatus(learnings, "superseded");
    expect(superseded).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    const result = filterLearningsByStatus([], "active");
    expect(result).toHaveLength(0);
  });
});
