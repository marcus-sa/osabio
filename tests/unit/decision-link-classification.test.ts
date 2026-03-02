import { describe, expect, it } from "bun:test";
import { classifyDecisionLinks } from "../../app/src/server/webhook/types";

const THRESHOLD = 0.85;

function entity(kind: "decision" | "task" | "person" | "feature" | "question", confidence: number, id = "e1") {
  return { id, kind, text: `${kind} entity`, confidence, sourceKind: "git_commit" as const, sourceId: "c1" };
}

describe("classifyDecisionLinks", () => {
  it("auto-links decision at threshold", () => {
    const actions = classifyDecisionLinks([entity("decision", 0.85)], THRESHOLD);
    expect(actions).toEqual([{ action: "auto_link", entityId: "e1", confidence: 0.85 }]);
  });

  it("auto-links decision above threshold", () => {
    const actions = classifyDecisionLinks([entity("decision", 0.95)], THRESHOLD);
    expect(actions).toEqual([{ action: "auto_link", entityId: "e1", confidence: 0.95 }]);
  });

  it("creates observation for decision below threshold", () => {
    const actions = classifyDecisionLinks([entity("decision", 0.7)], THRESHOLD);
    expect(actions).toEqual([{ action: "observe", entityId: "e1", text: "decision entity", confidence: 0.7 }]);
  });

  it("creates observation at just below threshold", () => {
    const actions = classifyDecisionLinks([entity("decision", 0.849)], THRESHOLD);
    expect(actions.length).toBe(1);
    expect(actions[0]!.action).toBe("observe");
  });

  it("skips non-decision entities", () => {
    const actions = classifyDecisionLinks(
      [entity("task", 0.95), entity("person", 0.9), entity("feature", 0.88)],
      THRESHOLD,
    );
    expect(actions).toEqual([]);
  });

  it("classifies mixed entities correctly", () => {
    const entities = [
      entity("decision", 0.92, "d1"),
      entity("task", 0.95, "t1"),
      entity("decision", 0.6, "d2"),
      entity("person", 0.99, "p1"),
      entity("decision", 0.85, "d3"),
    ];
    const actions = classifyDecisionLinks(entities, THRESHOLD);
    expect(actions).toEqual([
      { action: "auto_link", entityId: "d1", confidence: 0.92 },
      { action: "observe", entityId: "d2", text: "decision entity", confidence: 0.6 },
      { action: "auto_link", entityId: "d3", confidence: 0.85 },
    ]);
  });

  it("returns empty for no entities", () => {
    expect(classifyDecisionLinks([], THRESHOLD)).toEqual([]);
  });

  it("returns empty when no decisions present", () => {
    const actions = classifyDecisionLinks([entity("task", 0.5), entity("question", 0.9)], THRESHOLD);
    expect(actions).toEqual([]);
  });
});
