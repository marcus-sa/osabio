import { describe, expect, it, beforeEach } from "vitest";
import { useViewState } from "../../app/src/client/stores/view-state";

describe("view-state store", () => {
  beforeEach(() => {
    useViewState.setState({
      selectedEntityId: undefined,
      graphViewMode: "project",
      graphProjectId: undefined,
      graphCenterId: undefined,
      graphDepth: 2,
      highlightMessageId: undefined,
    });
  });

  it("selectEntity sets selectedEntityId", () => {
    useViewState.getState().selectEntity("task:abc");
    expect(useViewState.getState().selectedEntityId).toBe("task:abc");
  });

  it("selectEntity clears with undefined", () => {
    useViewState.getState().selectEntity("task:abc");
    useViewState.getState().selectEntity(undefined);
    expect(useViewState.getState().selectedEntityId).toBe(undefined);
  });

  it("navigateToGraph sets centerId, focused mode, and selectedEntityId", () => {
    useViewState.getState().navigateToGraph("decision:xyz");
    const state = useViewState.getState();
    expect(state.graphCenterId).toBe("decision:xyz");
    expect(state.graphViewMode).toBe("focused");
    expect(state.selectedEntityId).toBe("decision:xyz");
  });

  it("navigateToChat sets highlightMessageId", () => {
    useViewState.getState().navigateToChat("msg-123");
    expect(useViewState.getState().highlightMessageId).toBe("msg-123");
  });

  it("clearHighlight clears highlightMessageId", () => {
    useViewState.getState().navigateToChat("msg-123");
    useViewState.getState().clearHighlight();
    expect(useViewState.getState().highlightMessageId).toBe(undefined);
  });

  it("setGraphProject sets project and switches to project mode", () => {
    useViewState.getState().navigateToGraph("decision:xyz");
    expect(useViewState.getState().graphViewMode).toBe("focused");

    useViewState.getState().setGraphProject("proj-1");
    const state = useViewState.getState();
    expect(state.graphProjectId).toBe("proj-1");
    expect(state.graphViewMode).toBe("project");
  });

  it("setGraphDepth clamps to 1-3 range", () => {
    useViewState.getState().setGraphDepth(0);
    expect(useViewState.getState().graphDepth).toBe(1);

    useViewState.getState().setGraphDepth(5);
    expect(useViewState.getState().graphDepth).toBe(3);

    useViewState.getState().setGraphDepth(2);
    expect(useViewState.getState().graphDepth).toBe(2);
  });

  it("setGraphViewMode updates mode", () => {
    useViewState.getState().setGraphViewMode("focused");
    expect(useViewState.getState().graphViewMode).toBe("focused");

    useViewState.getState().setGraphViewMode("project");
    expect(useViewState.getState().graphViewMode).toBe("project");
  });
});
