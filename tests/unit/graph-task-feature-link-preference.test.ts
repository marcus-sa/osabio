import { describe, expect, it } from "bun:test";
import { preferTaskFeatureEdges, type GraphViewRawResult } from "../../app/src/server/graph/queries";

describe("preferTaskFeatureEdges", () => {
  it("drops task->project belongs_to when task already links to a feature", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "proj-1", kind: "project", name: "Checkout" },
        { id: "feat-1", kind: "feature", name: "Customer Slot Selection" },
        { id: "task-1", kind: "task", name: "Implement customer slot selection at checkout" },
      ],
      edges: [
        { id: "e1", kind: "has_feature", fromId: "proj-1", toId: "feat-1", confidence: 1 },
        { id: "e2", kind: "has_task", fromId: "feat-1", toId: "task-1", confidence: 1 },
        { id: "e3", kind: "belongs_to", fromId: "task-1", toId: "proj-1", confidence: 1 },
      ],
    };

    const result = preferTaskFeatureEdges(raw);
    const projectEdge = result.edges.find((edge) => edge.kind === "belongs_to" && edge.toId === "proj-1");
    expect(projectEdge).toBeUndefined();
  });

  it("infers task->feature belongs_to from exact name match under the same project", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "proj-1", kind: "project", name: "Checkout" },
        { id: "feat-1", kind: "feature", name: "Implement customer slot selection at checkout" },
        { id: "task-1", kind: "task", name: "Implement customer slot selection at checkout" },
      ],
      edges: [
        { id: "e1", kind: "has_feature", fromId: "proj-1", toId: "feat-1", confidence: 1 },
        { id: "e2", kind: "belongs_to", fromId: "task-1", toId: "proj-1", confidence: 1 },
      ],
    };

    const result = preferTaskFeatureEdges(raw);
    const projectEdge = result.edges.find((edge) => edge.kind === "belongs_to" && edge.fromId === "task-1" && edge.toId === "proj-1");
    const featureEdge = result.edges.find((edge) => edge.kind === "belongs_to" && edge.fromId === "task-1" && edge.toId === "feat-1");

    expect(projectEdge).toBeUndefined();
    expect(featureEdge).toBeDefined();
  });

  it("keeps task->project belongs_to when no unique feature name match exists", () => {
    const raw: GraphViewRawResult = {
      entities: [
        { id: "proj-1", kind: "project", name: "Checkout" },
        { id: "feat-1", kind: "feature", name: "Coupon Support" },
        { id: "task-1", kind: "task", name: "Implement customer slot selection at checkout" },
      ],
      edges: [
        { id: "e1", kind: "has_feature", fromId: "proj-1", toId: "feat-1", confidence: 1 },
        { id: "e2", kind: "belongs_to", fromId: "task-1", toId: "proj-1", confidence: 1 },
      ],
    };

    const result = preferTaskFeatureEdges(raw);
    const projectEdge = result.edges.find((edge) => edge.kind === "belongs_to" && edge.fromId === "task-1" && edge.toId === "proj-1");
    expect(projectEdge).toBeDefined();
  });
});
