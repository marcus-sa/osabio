import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  Session,
  Suggestion,
  MentionItem,
  ChatInputRef,
} from "reachat";
import type {
  BranchConversationResponse,
  ChatMessageResponse,
  OnboardingAction,
  SearchEntityResponse,
  StreamEvent as ChatStreamEvent,
  WorkspaceConversationResponse,
} from "../../shared/contracts";
import { useWorkspaceState, type BootstrapPayload } from "../stores/workspace-state";
import { useViewState } from "../stores/view-state";

type UseChatSessionReturn = {
  sessions: Session[];
  activeSessionId: string;
  activeSession: Session;
  activeConversationId?: string;
  isLoading: boolean;
  errorMessage?: string;
  suggestions: Suggestion[];
  pendingFile?: File;
  branchingFromId?: string;
  inheritedMessageIds: Set<string>;
  chatInputRef: React.RefObject<ChatInputRef | null>;
  onSendMessage: (message: string, options?: { onboardingAction?: OnboardingAction }) => Promise<void>;
  onStopMessage: () => void;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onBranchFromMessage: (messageId: string) => Promise<void>;
  searchMentions: (query: string) => Promise<MentionItem[]>;
  onUploadFile: (file: File) => void;
  onChatInputClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  setErrorMessage: (message: string | undefined) => void;
  refreshSidebar: (workspaceId: string) => Promise<void>;
};

export function useChatSession(): UseChatSessionReturn {
  const store = useWorkspaceState();
  const workspaceId = store.workspaceId;
  const workspaceName = store.workspaceName;
  const bootstrapPayload = store.bootstrapPayload;

  const [sessions, setSessions] = useState<Session[]>([
    {
      id: "main",
      title: "Workspace Chat",
      createdAt: new Date(),
      updatedAt: new Date(),
      conversations: [],
    },
  ]);
  const [activeSessionId] = useState("main");
  const [backendConversationId, setBackendConversationId] = useState<string | undefined>();
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [branchingFromId, setBranchingFromId] = useState<string | undefined>();
  const [inheritedMessageIds, setInheritedMessageIds] = useState<Set<string>>(new Set());
  const [pendingFile, setPendingFile] = useState<File | undefined>();
  const streamRef = useRef<EventSource | undefined>(undefined);
  const chatInputRef = useRef<ChatInputRef | null>(null);

  // Track the last applied bootstrap payload to avoid re-applying
  const appliedBootstrapRef = useRef<BootstrapPayload | undefined>(undefined);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );

  if (!activeSession) {
    throw new Error("active session missing");
  }

  // Apply bootstrap payload when it arrives
  useEffect(() => {
    if (!bootstrapPayload || bootstrapPayload === appliedBootstrapRef.current) {
      return;
    }
    appliedBootstrapRef.current = bootstrapPayload;

    setSessions([
      {
        id: "main",
        title: workspaceName ?? "Workspace Chat",
        createdAt: new Date(),
        updatedAt: new Date(),
        conversations: bootstrapPayload.conversations,
      },
    ]);
    setInheritedMessageIds(bootstrapPayload.inheritedIds);
    setSuggestions(
      bootstrapPayload.latestSuggestions.map((content, index) => ({
        id: `bootstrap-suggestion-${index}-${content}`,
        content,
      })),
    );
    setActiveConversationId(store.conversationId);
    setBackendConversationId(store.conversationId);
  }, [bootstrapPayload]);

  // Highlight message support (graph -> chat navigation)
  const highlightMessageId = useViewState((s) => s.highlightMessageId);
  const clearHighlight = useViewState((s) => s.clearHighlight);

  useEffect(() => {
    if (!highlightMessageId) return;

    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-message-id="${highlightMessageId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("animate-highlight");
        element.addEventListener(
          "animationend",
          () => {
            element.classList.remove("animate-highlight");
          },
          { once: true },
        );
      }
      clearHighlight();
    }, 100);

    return () => clearTimeout(timer);
  }, [highlightMessageId, clearHighlight]);

  async function refreshSidebar(wsId: string) {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/sidebar`);
      if (response.ok) {
        const payload = await response.json();
        store.setSidebar(payload);
      }
    } catch {
      // Sidebar refresh is non-critical; silently ignore
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
        return;
      }

      const payload = (await response.json()) as WorkspaceConversationResponse;
      const conversations: Session["conversations"] = [];
      let latestSuggestions: string[] = [];
      const inheritedIds = new Set<string>();

      for (const message of payload.messages) {
        if (message.role === "user") {
          conversations.push({
            id: message.id,
            question: message.text,
            createdAt: new Date(message.createdAt),
          });
          if (message.inherited) {
            inheritedIds.add(message.id);
          }
          continue;
        }

        const last = conversations[conversations.length - 1];
        if (last && !last.response) {
          last.response = message.text;
          last.updatedAt = new Date(message.createdAt);
          latestSuggestions =
            message.suggestions && message.suggestions.length > 0 ? message.suggestions : [];
          if (message.inherited) {
            inheritedIds.add(last.id);
          }
          continue;
        }

        conversations.push({
          id: `assistant-${message.id}`,
          question: "",
          response: message.text,
          createdAt: new Date(message.createdAt),
        });
        if (message.inherited) {
          inheritedIds.add(`assistant-${message.id}`);
        }
        latestSuggestions =
          message.suggestions && message.suggestions.length > 0 ? message.suggestions : [];
      }

      setInheritedMessageIds(inheritedIds);
      setSessions([
        {
          id: "main",
          title: workspaceName ?? "Workspace Chat",
          createdAt: new Date(),
          updatedAt: new Date(),
          conversations,
        },
      ]);

      setSuggestions(
        latestSuggestions.map((content, index) => ({
          id: `conv-suggestion-${index}-${content}`,
          content,
        })),
      );

      setActiveConversationId(conversationId);
      setBackendConversationId(conversationId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to load conversation";
      setErrorMessage(messageText);
    }
  }

  function onNewConversation() {
    setActiveConversationId(undefined);
    setBackendConversationId(undefined);
    setSessions([
      {
        id: "main",
        title: workspaceName ?? "Workspace Chat",
        createdAt: new Date(),
        updatedAt: new Date(),
        conversations: [],
      },
    ]);
    setSuggestions([]);
    setErrorMessage(undefined);
  }

  function onSelectConversation(conversationId: string) {
    if (conversationId === activeConversationId || isLoading || !workspaceId) {
      return;
    }

    void loadConversation(workspaceId, conversationId);
  }

  async function onBranchFromMessage(messageId: string) {
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
      await refreshSidebar(workspaceId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Branch creation failed";
      setErrorMessage(messageText);
    } finally {
      setBranchingFromId(undefined);
    }
  }

  async function searchMentions(query: string): Promise<MentionItem[]> {
    if (!workspaceId) {
      return [];
    }

    const response = await fetch(
      `/api/entities/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}&limit=8`,
    );
    if (!response.ok) {
      throw new Error(`entity search failed: ${response.status}`);
    }

    const rows = (await response.json()) as SearchEntityResponse[];
    return rows.map((row) => ({
      id: row.id,
      label: `${row.kind}: ${row.text.slice(0, 48)}`,
      description: `confidence ${row.confidence.toFixed(2)}`,
      value: `@${row.id}`,
    }));
  }

  function onUploadFile(file: File) {
    setPendingFile(file);
  }

  function onChatInputClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!pendingFile || isLoading) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const sendButton = target.closest("button[title='Send']");
    if (!sendButton) {
      return;
    }

    const currentMessage = chatInputRef.current?.getValue().trim() ?? "";
    if (currentMessage.length > 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void onSendMessage("");
  }

  async function onSendMessage(
    message: string,
    options?: { onboardingAction?: OnboardingAction },
  ) {
    if (isLoading || !workspaceId) {
      return;
    }

    const text = message.trim();
    if (!text && !pendingFile) {
      return;
    }

    setErrorMessage(undefined);
    setIsLoading(true);
    setSuggestions([]);

    const clientMessageId = crypto.randomUUID();
    const currentAttachment = pendingFile;

    setSessions((existing) =>
      existing.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              updatedAt: new Date(),
              conversations: [
                ...session.conversations,
                {
                  id: clientMessageId,
                  question: text.length > 0 ? text : `Uploaded ${currentAttachment?.name ?? "file"}`,
                  createdAt: new Date(),
                  ...(currentAttachment
                    ? {
                        files: [
                          {
                            name: currentAttachment.name,
                            type: currentAttachment.type,
                            size: currentAttachment.size,
                          },
                        ],
                      }
                    : {}),
                },
              ],
            }
          : session,
      ),
    );

    let response: Response;
    try {
      if (currentAttachment) {
        const formData = new FormData();
        formData.set("clientMessageId", clientMessageId);
        formData.set("workspaceId", workspaceId);
        formData.set("text", text);
        if (backendConversationId) {
          formData.set("conversationId", backendConversationId);
        }
        if (options?.onboardingAction) {
          formData.set("onboardingAction", options.onboardingAction);
        }
        formData.set("file", currentAttachment);

        response = await fetch("/api/chat/messages", {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch("/api/chat/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientMessageId,
            workspaceId,
            text,
            ...(backendConversationId ? { conversationId: backendConversationId } : {}),
            ...(options?.onboardingAction ? { onboardingAction: options.onboardingAction } : {}),
          }),
        });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Network error";
      setErrorMessage(messageText);
      setIsLoading(false);
      return;
    } finally {
      setPendingFile(undefined);
    }

    if (!response.ok) {
      const body = await response.text();
      setErrorMessage(body);
      setIsLoading(false);
      return;
    }

    const payload = (await response.json()) as ChatMessageResponse;
    const isNewConversation = !backendConversationId;
    setBackendConversationId(payload.conversationId);
    if (isNewConversation) {
      setActiveConversationId(payload.conversationId);
    }

    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = undefined;
    }

    let streamedText = "";

    const stream = new EventSource(payload.streamUrl);
    streamRef.current = stream;

    stream.onmessage = (messageEvent) => {
      const parsed = JSON.parse(messageEvent.data) as ChatStreamEvent;

      if (parsed.type === "token") {
        streamedText = `${streamedText}${parsed.token}`;
        setSessions((existing) =>
          existing.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  conversations: session.conversations.map((conversation) =>
                    conversation.id === clientMessageId
                      ? {
                          ...conversation,
                          response: streamedText,
                          updatedAt: new Date(),
                        }
                      : conversation,
                  ),
                }
              : session,
          ),
        );
        return;
      }

      if (parsed.type === "extraction") {
        store.mergeSeedItems(
          parsed.entities.map((entity) => ({
            id: entity.id,
            kind: entity.kind,
            text: entity.text,
            confidence: entity.confidence,
            sourceKind: entity.sourceKind,
            sourceId: entity.sourceId,
          })),
        );
        return;
      }

      if (parsed.type === "assistant_message") {
        streamedText = parsed.text;
        setSuggestions(
          (parsed.suggestions ?? []).map((content, index) => ({
            id: `suggestion-${parsed.messageId}-${index}-${content}`,
            content,
          })),
        );
        setSessions((existing) =>
          existing.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  conversations: session.conversations.map((conversation) =>
                    conversation.id === clientMessageId
                      ? {
                          ...conversation,
                          response: streamedText,
                          updatedAt: new Date(),
                        }
                      : conversation,
                  ),
                }
              : session,
          ),
        );
        return;
      }

      if (parsed.type === "onboarding_seed") {
        store.mergeSeedItems(parsed.seeds);
        return;
      }

      if (parsed.type === "onboarding_state") {
        store.setOnboardingState(parsed.onboardingState);
        return;
      }

      if (parsed.type === "error") {
        setErrorMessage(parsed.error);
        setIsLoading(false);
        stream.close();
        streamRef.current = undefined;
        return;
      }

      if (parsed.type === "done") {
        setSessions((existing) =>
          existing.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  updatedAt: new Date(),
                  conversations: session.conversations.map((conversation) =>
                    conversation.id === clientMessageId
                      ? {
                          ...conversation,
                          response: streamedText,
                          updatedAt: new Date(),
                        }
                      : conversation,
                  ),
                }
              : session,
          ),
        );

        setIsLoading(false);
        stream.close();
        streamRef.current = undefined;

        // Refresh sidebar after stream completes
        if (workspaceId) {
          void refreshSidebar(workspaceId);
        }
      }
    };

    stream.onerror = () => {
      setErrorMessage("SSE stream disconnected");
      setIsLoading(false);
      stream.close();
      streamRef.current = undefined;
    };
  }

  function onStopMessage() {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.close();
    streamRef.current = undefined;
    setIsLoading(false);
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    activeConversationId,
    isLoading,
    errorMessage,
    suggestions,
    pendingFile,
    branchingFromId,
    inheritedMessageIds,
    chatInputRef,
    onSendMessage,
    onStopMessage,
    onNewConversation,
    onSelectConversation,
    onBranchFromMessage,
    searchMentions,
    onUploadFile,
    onChatInputClickCapture,
    setErrorMessage,
    refreshSidebar,
  };
}
