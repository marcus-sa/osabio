import { create } from "zustand";

type ViewState = {
  selectedEntityId: string | undefined;
  graphViewMode: "project" | "focused";
  graphProjectId: string | undefined;
  graphCenterId: string | undefined;
  graphDepth: number;
  highlightMessageId: string | undefined;

  selectEntity: (entityId: string | undefined) => void;
  setGraphViewMode: (mode: "project" | "focused") => void;
  setGraphProject: (projectId: string) => void;
  setGraphDepth: (depth: number) => void;
  navigateToGraph: (entityId: string) => void;
  navigateToChat: (messageId: string) => void;
  clearHighlight: () => void;
};

export const useViewState = create<ViewState>((set) => ({
  selectedEntityId: undefined,
  graphViewMode: "project",
  graphProjectId: undefined,
  graphCenterId: undefined,
  graphDepth: 2,
  highlightMessageId: undefined,

  selectEntity: (entityId) => set({ selectedEntityId: entityId }),

  setGraphViewMode: (mode) => set({ graphViewMode: mode }),

  setGraphProject: (projectId) =>
    set({ graphProjectId: projectId, graphViewMode: "project" }),

  setGraphDepth: (depth) => set({ graphDepth: Math.max(1, Math.min(3, depth)) }),

  navigateToGraph: (entityId) =>
    set({
      graphCenterId: entityId,
      graphViewMode: "focused",
      selectedEntityId: entityId,
    }),

  navigateToChat: (messageId) =>
    set({ highlightMessageId: messageId }),

  clearHighlight: () => set({ highlightMessageId: undefined }),
}));
