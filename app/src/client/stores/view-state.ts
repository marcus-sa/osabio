import { create } from "zustand";
import type { DiscussEntitySummary } from "../../shared/contracts";

type ViewState = {
  selectedEntityId: string | undefined;
  graphViewMode: "project" | "focused";
  graphProjectId: string | undefined;
  graphCenterId: string | undefined;
  graphDepth: number;
  highlightMessageId: string | undefined;
  discussEntity: DiscussEntitySummary | undefined;

  selectEntity: (entityId: string | undefined) => void;
  setGraphViewMode: (mode: "project" | "focused") => void;
  setGraphProject: (projectId: string) => void;
  setGraphDepth: (depth: number) => void;
  navigateToGraph: (entityId: string) => void;
  navigateToChat: (messageId: string) => void;
  clearHighlight: () => void;
  navigateToDiscussEntity: (entity: DiscussEntitySummary) => void;
  clearDiscussEntity: () => void;
};

export const useViewState = create<ViewState>((set) => ({
  selectedEntityId: undefined,
  graphViewMode: "project",
  graphProjectId: undefined,
  graphCenterId: undefined,
  graphDepth: 2,
  highlightMessageId: undefined,
  discussEntity: undefined,

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

  navigateToDiscussEntity: (entity) =>
    set({ discussEntity: entity }),

  clearDiscussEntity: () => set({ discussEntity: undefined }),
}));
