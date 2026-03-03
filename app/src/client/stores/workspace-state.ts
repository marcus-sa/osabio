import { create } from "zustand";
import type { Session } from "reachat";
import type {
  OnboardingSeedItem,
  OnboardingState,
  WorkspaceConversationSidebarResponse,
} from "../../shared/contracts";

export type SidebarHandlers = {
  activeConversationId?: string;
  isLoading: boolean;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
};

export type BootstrapPayload = {
  conversations: Session["conversations"];
  latestSuggestions: string[];
  inheritedIds: Set<string>;
};

type WorkspaceStateStore = {
  workspaceId?: string;
  workspaceName?: string;
  onboardingComplete: boolean;
  onboardingState?: OnboardingState;
  conversationId?: string;
  sidebar?: WorkspaceConversationSidebarResponse;
  seedItems: OnboardingSeedItem[];
  isBootstrapping: boolean;
  sidebarHandlers?: SidebarHandlers;
  bootstrapPayload?: BootstrapPayload;

  setWorkspaceId: (workspaceId: string | undefined) => void;
  setWorkspaceName: (name: string) => void;
  setOnboardingState: (state: OnboardingState) => void;
  setConversationId: (id: string | undefined) => void;
  setSidebar: (sidebar: WorkspaceConversationSidebarResponse | undefined) => void;
  setSeedItems: (items: OnboardingSeedItem[]) => void;
  mergeSeedItems: (items: OnboardingSeedItem[]) => void;
  setIsBootstrapping: (value: boolean) => void;
  setSidebarHandlers: (handlers: SidebarHandlers | undefined) => void;
  setBootstrapPayload: (payload: BootstrapPayload | undefined) => void;
  clearWorkspace: () => void;
  applyWorkspace: (ws: {
    id: string;
    name: string;
    onboardingComplete: boolean;
    onboardingState: OnboardingState;
    conversationId: string;
  }) => void;
};

export const useWorkspaceState = create<WorkspaceStateStore>((set, get) => ({
  workspaceId: undefined,
  workspaceName: undefined,
  onboardingComplete: false,
  onboardingState: undefined,
  conversationId: undefined,
  sidebar: undefined,
  seedItems: [],
  isBootstrapping: false,
  sidebarHandlers: undefined,
  bootstrapPayload: undefined,

  setWorkspaceId: (workspaceId) => set({ workspaceId }),
  setWorkspaceName: (name) => set({ workspaceName: name }),
  setOnboardingState: (onboardingState) =>
    set({ onboardingState, onboardingComplete: onboardingState === "complete" }),
  setConversationId: (conversationId) => set({ conversationId }),
  setSidebar: (sidebar) => set({ sidebar }),
  setSeedItems: (seedItems) => set({ seedItems }),
  mergeSeedItems: (items) => {
    const existing = get().seedItems;
    const deduped = new Map(
      existing.map((item) => [`${item.id}:${item.sourceKind}:${item.sourceId}`, item]),
    );
    for (const item of items) {
      const key = `${item.id}:${item.sourceKind}:${item.sourceId}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    }
    set({ seedItems: [...deduped.values()] });
  },
  setIsBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
  setSidebarHandlers: (sidebarHandlers) => set({ sidebarHandlers }),
  setBootstrapPayload: (bootstrapPayload) => set({ bootstrapPayload }),
  clearWorkspace: () =>
    set({
      workspaceId: undefined,
      workspaceName: undefined,
      onboardingComplete: false,
      onboardingState: undefined,
      conversationId: undefined,
      sidebar: undefined,
      seedItems: [],
      isBootstrapping: false,
      sidebarHandlers: undefined,
      bootstrapPayload: undefined,
    }),
  applyWorkspace: (ws) =>
    set({
      workspaceId: ws.id,
      workspaceName: ws.name,
      onboardingComplete: ws.onboardingComplete,
      onboardingState: ws.onboardingState,
      conversationId: ws.conversationId,
    }),
}));
