import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type {
  BranchConversationResponse,
  DiscussEntitySummary,
  OnboardingAction,
  OnboardingState,
  WorkspaceBootstrapMessage,
  WorkspaceConversationResponse,
} from "../../shared/contracts";
import { useWorkspaceState, type BootstrapPayload } from "../stores/workspace-state";
import { useViewState } from "../stores/view-state";

type ChatMessageMetadata = {
  onboardingState?: OnboardingState;
  conversationId?: string;
};

type ChatUIMessage = UIMessage<ChatMessageMetadata>;

export type UseChatSessionReturn = {
  messages: ChatUIMessage[];
  status: UseChatHelpers<ChatUIMessage>["status"];
  isLoading: boolean;
  errorMessage?: string;
  activeConversationId?: string;
  branchingFromId?: string;
  discussEntity?: DiscussEntitySummary;
  conversationDiscussEntity?: DiscussEntitySummary;
  sendMessage: (text: string, options?: { onboardingAction?: OnboardingAction }) => void;
  stopMessage: () => void;
  newConversation: () => void;
  resetChat: () => void;
  selectConversation: (conversationId: string) => void;
  branchFromMessage: (messageId: string) => Promise<void>;
  setErrorMessage: (message: string | undefined) => void;
  refreshSidebar: (workspaceId: string) => Promise<void>;
};

function bootstrapMessagesToUIMessages(messages: WorkspaceBootstrapMessage[]): ChatUIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.text }],
    createdAt: new Date(m.createdAt),
  }));
}

export function useChatSession(routeConversationId?: string): UseChatSessionReturn {
  const store = useWorkspaceState();
  const workspaceId = store.workspaceId;
  const bootstrapPayload = store.bootstrapPayload;
  const navigate = useNavigate();

  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [branchingFromId, setBranchingFromId] = useState<string | undefined>();
  const [conversationDiscussEntity, setConversationDiscussEntity] = useState<
    DiscussEntitySummary | undefined
  >();

  const discussEntity = useViewState((s) => s.discussEntity);
  const clearDiscussEntity = useViewState((s) => s.clearDiscussEntity);

  // Dynamic body refs — these are read by the transport body function
  const conversationIdRef = useRef<string | undefined>(undefined);
  const onboardingActionRef = useRef<OnboardingAction | undefined>(undefined);
  const discussEntityIdRef = useRef<string | undefined>(undefined);

  // Keep conversationId ref in sync
  useEffect(() => {
    conversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Keep discuss entity ref in sync
  useEffect(() => {
    discussEntityIdRef.current = discussEntity?.id;
  }, [discussEntity]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          workspaceId,
          ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
          ...(onboardingActionRef.current
            ? { onboardingAction: onboardingActionRef.current }
            : {}),
          ...(discussEntityIdRef.current
            ? { discussEntityId: discussEntityIdRef.current }
            : {}),
        }),
      }),
    [workspaceId],
  );

  const chat = useChat<ChatUIMessage>({
    transport,
    onFinish: ({ message }) => {
      const metadata = message.metadata;
      if (metadata?.conversationId && !conversationIdRef.current) {
        setActiveConversationId(metadata.conversationId);
        conversationIdRef.current = metadata.conversationId;
        void navigate({
          to: "/chat/$conversationId",
          params: { conversationId: metadata.conversationId },
          replace: true,
        });
        if (discussEntity) {
          clearDiscussEntity();
        }
      }
      if (metadata?.onboardingState) {
        store.setOnboardingState(metadata.onboardingState);
      }

      // Refresh sidebar
      if (workspaceId) {
        void refreshSidebar(workspaceId);
      }
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const isLoading = chat.status === "streaming" || chat.status === "submitted";

  // Apply bootstrap payload when it arrives — only load messages when on /chat/:id
  const appliedBootstrapRef = useRef<BootstrapPayload | undefined>(undefined);
  useEffect(() => {
    if (!bootstrapPayload || bootstrapPayload === appliedBootstrapRef.current) {
      return;
    }
    appliedBootstrapRef.current = bootstrapPayload;

    // On /chat (new conversation), skip loading bootstrap messages
    if (!routeConversationId) {
      return;
    }

    chat.setMessages(bootstrapPayload.messages as ChatUIMessage[]);
    setActiveConversationId(store.conversationId);
    conversationIdRef.current = store.conversationId;
  }, [bootstrapPayload, routeConversationId]);

  async function refreshSidebar(wsId: string) {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/sidebar`);
      if (response.ok) {
        const payload = await response.json();
        store.setSidebar(payload);
      }
    } catch {
      // Sidebar refresh is non-critical
    }
  }

  async function loadConversation(wsId: string, conversationId: string) {
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/conversations/${encodeURIComponent(conversationId)}`,
      );
      if (!response.ok) {
        const body = await response.text();
        setErrorMessage(body);
        void navigate({ to: "/chat", replace: true });
        return;
      }

      const payload = (await response.json()) as WorkspaceConversationResponse;
      const uiMessages = bootstrapMessagesToUIMessages(payload.messages) as ChatUIMessage[];
      chat.setMessages(uiMessages);

      setActiveConversationId(conversationId);
      conversationIdRef.current = conversationId;
      setConversationDiscussEntity(payload.discussEntity);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to load conversation";
      setErrorMessage(messageText);
    }
  }

  const sendMessage = useCallback(
    (text: string, options?: { onboardingAction?: OnboardingAction }) => {
      if (isLoading || !workspaceId) return;

      const trimmed = text.trim();
      if (!trimmed) return;

      setErrorMessage(undefined);
      onboardingActionRef.current = options?.onboardingAction;

      chat.sendMessage({ text: trimmed });

      // Clear after queueing
      onboardingActionRef.current = undefined;
    },
    [isLoading, workspaceId, chat.sendMessage],
  );

  function stopMessage() {
    chat.stop();
  }

  function newConversation() {
    setActiveConversationId(undefined);
    conversationIdRef.current = undefined;
    chat.setMessages([]);
    setErrorMessage(undefined);
    setConversationDiscussEntity(undefined);
    clearDiscussEntity();
    void navigate({ to: "/chat" });
  }

  function resetChat() {
    setActiveConversationId(undefined);
    conversationIdRef.current = undefined;
    chat.setMessages([]);
    setErrorMessage(undefined);
    setConversationDiscussEntity(undefined);
  }

  function selectConversation(conversationId: string) {
    if (conversationId === activeConversationId || isLoading || !workspaceId) {
      return;
    }
    clearDiscussEntity();
    void loadConversation(workspaceId, conversationId);
  }

  async function branchFromMessage(messageId: string) {
    if (!workspaceId || !activeConversationId || isLoading) return;

    setBranchingFromId(messageId);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(activeConversationId)}/branch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        setErrorMessage(body);
        return;
      }

      const payload = (await response.json()) as BranchConversationResponse;
      await loadConversation(workspaceId, payload.conversationId);
      void navigate({
        to: "/chat/$conversationId",
        params: { conversationId: payload.conversationId },
      });
      await refreshSidebar(workspaceId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Branch creation failed";
      setErrorMessage(messageText);
    } finally {
      setBranchingFromId(undefined);
    }
  }

  return {
    messages: chat.messages,
    status: chat.status,
    isLoading,
    errorMessage,
    activeConversationId,
    branchingFromId,
    discussEntity,
    conversationDiscussEntity,
    sendMessage,
    stopMessage,
    newConversation,
    resetChat,
    selectConversation,
    branchFromMessage,
    setErrorMessage,
    refreshSidebar,
  };
}
