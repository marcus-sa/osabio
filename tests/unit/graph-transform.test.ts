import { describe, expect, it } from "vitest";
import { entityColor, transformToReagraph } from "../../app/src/server/graph/transform";
import type { GraphViewRawResult } from "../../app/src/server/graph/queries";

describe("entityColor", () => {
  it("returns hex color for each entity kind", () => {
    expect(entityColor("project")).toBe("#3b82f6");
    expect(entityColor("feature")).toBe("#14b8a6");
    expect(entityColor("task")).toBe("#22c55e");
    expect(entityColor("decision")).toBe("#eab308");
    expect(entityColor("question")).toBe("#a855f7");
    expect(entityColor("observation")).toBe("#ef4444");
    expect(entityColor("person")).toBe("#f97316");
    expect(entityColor("workspace")).toBe("#3b82f6");
    expect(entityColor("objective")).toBe("#10b981");
    expect(entityColor("behavior")).toBe("#8b5cf6");
  });
});

describe("transformToReagraph", () => {
  it("returns empty arrays for empty input", () => {
    const raw: GraphViewRawResult = { entities: [], edges: [] };
    const result = transformToReagraph(raw);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("maps entities to Reagraph nodes with correct fields", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "abc123", kind: "task", name: "Build the login page" },
        { id: "def456", kind: "decision", name: "Use JWT for auth" },
      ],
      edges: [],
    };

    const result = transformToReagraph(raw);
    expect(result.nodes).toHaveLength(2);

    expect(result.nodes[0]).toEqual({
      id: "abc123",
      label: "Build the login page",
      fill: "#22c55e",
      data: {
        kind: "task",
        connectionCount: 0,
        status: undefined,
      },
    });

    expect(result.nodes[1]).toEqual({
      id: "def456",
      label: "Use JWT for auth",
      fill: "#eab308",
      data: {
        kind: "decision",
        connectionCount: 0,
        status: undefined,
      },
    });
  });

  it("truncates long entity names at 32 characters with ellipsis", () => {
    const raw: GraphViewRawResult = {
      entities: [
        {
          id: "long1",
          kind: "feature",
          name: "This is a very long entity name that should be truncated",
        },
      ],
      edges: [],
    };

    const result = transformToReagraph(raw);
    expect(result.nodes[0].label).toBe("This is a very long entity name \u2026");
    expect(result.nodes[0].label.length).toBe(33);
  });

  it("does not truncate names at exactly 32 characters", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "exact", kind: "task", name: "12345678901234567890123456789012" },
      ],
      edges: [],
    };

    const result = transformToReagraph(raw);
    expect(result.nodes[0].label).toBe("12345678901234567890123456789012");
  });

  it("maps edges to Reagraph edges with title-cased labels", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "a", kind: "task", name: "Task A" },
        { id: "b", kind: "feature", name: "Feature B" },
      ],
      edges: [
        { id: "edge1", fromId: "a", toId: "b", kind: "belongs_to", confidence: 0.9 },
      ],
    };

    const result = transformToReagraph(raw);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      id: "edge1",
      source: "a",
      target: "b",
      label: "Belongs To",
      data: {
        type: "belongs_to",
        confidence: 0.9,
      },
    });
  });

  it("computes connection counts correctly", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "a", kind: "project", name: "Project A" },
        { id: "b", kind: "feature", name: "Feature B" },
        { id: "c", kind: "task", name: "Task C" },
      ],
      edges: [
        { id: "e1", fromId: "a", toId: "b", kind: "has_feature", confidence: 1 },
        { id: "e2", fromId: "b", toId: "c", kind: "has_task", confidence: 1 },
        { id: "e3", fromId: "a", toId: "c", kind: "belongs_to", confidence: 0.8 },
      ],
    };

    const result = transformToReagraph(raw);
    const countByNode = new Map(result.nodes.map((n) => [n.id, n.data.connectionCount]));

    expect(countByNode.get("a")).toBe(22); // 2 edges + project kindBoost 20
    expect(countByNode.get("b")).toBe(12); // 2 edges + feature kindBoost 10
    expect(countByNode.get("c")).toBe(2);  // 2 edges + task kindBoost 0
  });

  it("maps objective nodes with emerald color", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "obj1", kind: "objective", name: "Increase test coverage" },
      ],
      edges: [],
    };

    const result = transformToReagraph(raw);
    expect(result.nodes[0]).toEqual({
      id: "obj1",
      label: "Increase test coverage",
      fill: "#10b981",
      data: {
        kind: "objective",
        connectionCount: 0,
        status: undefined,
      },
    });
  });

  it("maps behavior nodes with violet color", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "beh1", kind: "behavior", name: "TDD_Adherence" },
      ],
      edges: [],
    };

    const result = transformToReagraph(raw);
    expect(result.nodes[0]).toEqual({
      id: "beh1",
      label: "TDD_Adherence",
      fill: "#8b5cf6",
      data: {
        kind: "behavior",
        connectionCount: 0,
        status: undefined,
      },
    });
  });

  it("maps supports and exhibits edges with title-cased labels", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "int1", kind: "intent", name: "Deploy service" },
        { id: "obj1", kind: "objective", name: "Reliability target" },
        { id: "id1", kind: "identity", name: "Agent A" },
        { id: "beh1", kind: "behavior", name: "Security_First" },
      ],
      edges: [
        { id: "e1", fromId: "int1", toId: "obj1", kind: "supports", confidence: 0.85 },
        { id: "e2", fromId: "id1", toId: "beh1", kind: "exhibits", confidence: 1.0 },
      ],
    };

    const result = transformToReagraph(raw);
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].label).toBe("Supports");
    expect(result.edges[0].data.type).toBe("supports");
    expect(result.edges[1].label).toBe("Exhibits");
    expect(result.edges[1].data.type).toBe("exhibits");
  });

  it("handles edges referencing same entity in both source and target", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "hub", kind: "project", name: "Hub" },
        { id: "s1", kind: "feature", name: "Spoke 1" },
        { id: "s2", kind: "feature", name: "Spoke 2" },
        { id: "s3", kind: "feature", name: "Spoke 3" },
      ],
      edges: [
        { id: "e1", fromId: "hub", toId: "s1", kind: "has_feature", confidence: 1 },
        { id: "e2", fromId: "hub", toId: "s2", kind: "has_feature", confidence: 1 },
        { id: "e3", fromId: "hub", toId: "s3", kind: "has_feature", confidence: 1 },
      ],
    };

    const result = transformToReagraph(raw);
    const hubNode = result.nodes.find((n) => n.id === "hub");
    expect(hubNode?.data.connectionCount).toBe(23); // 3 edges + project kindBoost 20
  });
});
