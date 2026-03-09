import { describe, expect, it } from "vitest";
import { entityColor, entityMutedColor, edgeStyle } from "../../app/src/client/components/graph/graph-theme";

describe("entityColor", () => {
  it("returns CSS variable for each entity kind", () => {
    expect(entityColor("project")).toBe("var(--entity-project)");
    expect(entityColor("feature")).toBe("var(--entity-feature)");
    expect(entityColor("task")).toBe("var(--entity-task)");
    expect(entityColor("decision")).toBe("var(--entity-decision)");
    expect(entityColor("question")).toBe("var(--entity-question)");
    expect(entityColor("observation")).toBe("var(--entity-decision)");
    expect(entityColor("person")).toBe("var(--entity-person)");
    expect(entityColor("workspace")).toBe("var(--entity-project)");
  });
});

describe("entityMutedColor", () => {
  it("returns muted CSS variable for each entity kind", () => {
    expect(entityMutedColor("project")).toBe("var(--entity-project-muted)");
    expect(entityMutedColor("feature")).toBe("var(--entity-feature-muted)");
    expect(entityMutedColor("task")).toBe("var(--entity-task-muted)");
    expect(entityMutedColor("decision")).toBe("var(--entity-decision-muted)");
    expect(entityMutedColor("question")).toBe("var(--entity-question-muted)");
    expect(entityMutedColor("observation")).toBe("var(--entity-decision-muted)");
    expect(entityMutedColor("person")).toBe("var(--entity-person-muted)");
    expect(entityMutedColor("workspace")).toBe("var(--entity-project-muted)");
  });
});

describe("edgeStyle", () => {
  it("returns dashed style for depends_on", () => {
    const style = edgeStyle("depends_on");
    expect(style.strokeDasharray).toBe("4 2");
    expect(style.opacity).toBe(0.8);
  });

  it("returns red style for conflicts_with", () => {
    const style = edgeStyle("conflicts_with");
    expect(style.stroke).toBe("#d66a8a");
    expect(style.opacity).toBe(0.9);
  });

  it("returns subtle style for structural edges", () => {
    for (const type of ["belongs_to", "has_feature", "has_task", "has_project"]) {
      const style = edgeStyle(type);
      expect(style.opacity).toBe(0.3);
      expect(style.strokeDasharray).toBe("none");
    }
  });

  it("returns default style for unknown types", () => {
    const style = edgeStyle("unknown_relation");
    expect(style.opacity).toBe(0.5);
    expect(style.strokeDasharray).toBe("none");
  });
});
