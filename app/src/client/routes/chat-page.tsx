import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Chat,
  ChatSuggestions,
  ChatInput,
  SessionMessage,
  SessionMessagePanel,
  SessionMessages,
  SessionMessagesHeader,
  type MentionItem,
  type ChatInputRef,
  type Session,
  type Suggestion,
  type SlashCommandItem,
} from "reachat";
import type {
  BranchConversationResponse,
  ChatMessageResponse,
  ConversationSidebarItem,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  OnboardingAction,
  OnboardingSeedItem,
  SearchEntityResponse,
  StreamEvent as ChatStreamEvent,
  WorkspaceBootstrapResponse,
  WorkspaceConversationSidebarResponse,
  WorkspaceConversationResponse,
} from "../../shared/contracts";
import { chatComponentCatalog } from "../chat-component-catalog";
import { useViewState } from "../stores/view-state";
import { useWorkspaceState } from "../stores/workspace-state";

type WorkspaceState = {
  id: string;
  name: string;
  onboardingComplete: boolean;
  onboardingState: "active" | "summary_pending" | "complete";
  conversationId: string;
};

const COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: "task",
    label: "task",
    description: "Record a task",
    type: "insert",
    value: "task: ",
  },
  {
    id: "decision",
    label: "decision",
    description: "Record a decision",
    type: "insert",
    value: "decision: ",
  },
  {
    id: "question",
    label: "question",
    description: "Record an open question",
    type: "insert",
    value: "question: ",
  },
];

const ACTIVE_WORKSPACE_STORAGE_KEY = "brain.activeWorkspaceId";

export function ChatPage() {
  const setGlobalWorkspaceId = useWorkspaceState((s) => s.setWorkspaceId);
  const [workspace, setWorkspace] = useState<WorkspaceState | undefined>();
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [createOwnerName, setCreateOwnerName] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
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
  const [sidebar, setSidebar] = useState<WorkspaceConversationSidebarResponse | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [seedItems, setSeedItems] = useState<OnboardingSeedItem[]>([]);
  const [isSeedPanelOpen, setIsSeedPanelOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [branchingFromId, setBranchingFromId] = useState<string | undefined>();
  const [inheritedMessageIds, setInheritedMessageIds] = useState<Set<string>>(new Set());
  const [pendingFile, setPendingFile] = useState<File | undefined>();
  const streamRef = useRef<EventSource | undefined>(undefined);
  const chatInputRef = useRef<ChatInputRef | null>(null);
  const canCreateWorkspace =
    createWorkspaceName.trim().length > 0 && createOwnerName.trim().length > 0;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );

  const highlightMessageId = useViewState((s) => s.highlightMessageId);
  const clearHighlight = useViewState((s) => s.clearHighlight);

  useEffect(() => {
    if (!highlightMessageId) return;

    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-message-id="${highlightMessageId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("animate-highlight");
        element.addEventListener("animationend", () => {
          element.classList.remove("animate-highlight");
        }, { once: true });
      }
      clearHighlight();
    }, 100);

    return () => clearTimeout(timer);
  }, [highlightMessageId, clearHighlight]);

  useEffect(() => {
    const existingWorkspaceId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    if (!existingWorkspaceId) {
      return;
    }

    void bootstrapWorkspace(existingWorkspaceId);
  }, []);

  if (!activeSession) {
    throw new Error("active session missing");
  }

  async function refreshSidebar(workspaceId: string) {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sidebar`);
      if (response.ok) {
        const payload = (await response.json()) as WorkspaceConversationSidebarResponse;
        setSidebar(payload);
      }
    } catch {
      // Sidebar refresh is non-critical; silently ignore
    }
  }

  async function loadConversation(workspaceId: string, conversationId: string) {
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
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
          latestSuggestions = message.suggestions && message.suggestions.length > 0 ? message.suggestions : [];
          if (message.inherited) {
            inheritedIds.add(last.id);
          }
          continue;
        }

        conversations.push({
          id: `assistant-${message.id}`,
          question: "System kickoff",
          response: message.text,
          createdAt: new Date(message.createdAt),
        });
        if (message.inherited) {
          inheritedIds.add(`assistant-${message.id}`);
        }
        latestSuggestions = message.suggestions && message.suggestions.length > 0 ? message.suggestions : [];
      }

      setInheritedMessageIds(inheritedIds);
      setSessions([
        {
          id: "main",
          title: workspace?.name ?? "Workspace Chat",
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

  async function bootstrapWorkspace(workspaceId: string) {
    setIsBootstrapping(true);
    setErrorMessage(undefined);

    let response: Response;
    try {
      response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/bootstrap`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Network error";
      setErrorMessage(messageText);
      setIsBootstrapping(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 404) {
        window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
        setWorkspace(undefined);
      }
      const body = await response.text();
      setErrorMessage(body);
      setIsBootstrapping(false);
      return;
    }

    const payload = (await response.json()) as WorkspaceBootstrapResponse;
    applyBootstrapPayload(payload);
    setIsBootstrapping(false);
  }

  function applyBootstrapPayload(payload: WorkspaceBootstrapResponse) {
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
        latestSuggestions = message.suggestions && message.suggestions.length > 0 ? message.suggestions : [];
        if (message.inherited) {
          inheritedIds.add(last.id);
        }
        continue;
      }

      conversations.push({
        id: `assistant-${message.id}`,
        question: "System kickoff",
        response: message.text,
        createdAt: new Date(message.createdAt),
      });
      if (message.inherited) {
        inheritedIds.add(`assistant-${message.id}`);
      }
      latestSuggestions = message.suggestions && message.suggestions.length > 0 ? message.suggestions : [];
    }

    setInheritedMessageIds(inheritedIds);
    setSessions([
      {
        id: "main",
        title: payload.workspaceName,
        createdAt: new Date(),
        updatedAt: new Date(),
        conversations,
      },
    ]);

    setSeedItems(payload.seeds);
    setSuggestions(
      latestSuggestions.map((content, index) => ({
        id: `bootstrap-suggestion-${index}-${content}`,
        content,
      })),
    );
    setBackendConversationId(payload.conversationId);
    setActiveConversationId(payload.conversationId);
    setSidebar(payload.sidebar);
    setGlobalWorkspaceId(payload.workspaceId);
    setWorkspace({
      id: payload.workspaceId,
      name: payload.workspaceName,
      onboardingComplete: payload.onboardingComplete,
      onboardingState: payload.onboardingState,
      conversationId: payload.conversationId,
    });
  }

  function onNewConversation() {
    setActiveConversationId(undefined);
    setBackendConversationId(undefined);
    setSessions([
      {
        id: "main",
        title: workspace?.name ?? "Workspace Chat",
        createdAt: new Date(),
        updatedAt: new Date(),
        conversations: [],
      },
    ]);
    setSuggestions([]);
    setErrorMessage(undefined);
  }

  function onSelectConversation(conversationId: string) {
    if (conversationId === activeConversationId || isLoading || !workspace) {
      return;
    }

    void loadConversation(workspace.id, conversationId);
  }

  async function onBranchFromMessage(messageId: string) {
    if (!workspace || !activeConversationId || isLoading) return;

    setBranchingFromId(messageId);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/conversations/${encodeURIComponent(activeConversationId)}/branch`,
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
      await loadConversation(workspace.id, payload.conversationId);
      await refreshSidebar(workspace.id);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Branch creation failed";
      setErrorMessage(messageText);
    } finally {
      setBranchingFromId(undefined);
    }
  }

  async function searchMentions(query: string): Promise<MentionItem[]> {
    if (!workspace) {
      return [];
    }

    const response = await fetch(
      `/api/entities/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspace.id)}&limit=8`,
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

  async function onCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = createWorkspaceName.trim();
    const ownerDisplayName = createOwnerName.trim();
    if (isCreatingWorkspace) {
      return;
    }

    if (!name || !ownerDisplayName) {
      setErrorMessage("Workspace name and owner display name are required");
      return;
    }

    setErrorMessage(undefined);
    setIsCreatingWorkspace(true);

    const requestBody: CreateWorkspaceRequest = {
      name,
      ownerDisplayName,
    };

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const body = await response.text();
        setErrorMessage(body);
        return;
      }

      const payload = (await response.json()) as Partial<CreateWorkspaceResponse>;
      if (typeof payload.workspaceId !== "string" || payload.workspaceId.trim().length === 0) {
        throw new Error("create workspace response is missing workspaceId");
      }

      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, payload.workspaceId);
      await bootstrapWorkspace(payload.workspaceId);
      setCreateWorkspaceName("");
      setCreateOwnerName("");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Workspace creation failed";
      setErrorMessage(messageText);
    } finally {
      setIsCreatingWorkspace(false);
    }
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

  async function onSendMessage(message: string, options?: { onboardingAction?: OnboardingAction }) {
    if (isLoading || !workspace) {
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
        formData.set("workspaceId", workspace.id);
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
            workspaceId: workspace.id,
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
        setSeedItems((existing) => {
          const deduped = new Map(existing.map((item) => [`${item.id}:${item.sourceKind}:${item.sourceId}`, item]));
          for (const entity of parsed.entities) {
            const key = `${entity.id}:${entity.sourceKind}:${entity.sourceId}`;
            if (!deduped.has(key)) {
              deduped.set(key, {
                id: entity.id,
                kind: entity.kind,
                text: entity.text,
                confidence: entity.confidence,
                sourceKind: entity.sourceKind,
                sourceId: entity.sourceId,
              });
            }
          }
          return [...deduped.values()];
        });
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
        setSeedItems((existing) => {
          const deduped = new Map(existing.map((item) => [`${item.id}:${item.sourceKind}:${item.sourceId}`, item]));
          for (const seed of parsed.seeds) {
            deduped.set(`${seed.id}:${seed.sourceKind}:${seed.sourceId}`, seed);
          }
          return [...deduped.values()];
        });
        return;
      }

      if (parsed.type === "onboarding_state") {
        setWorkspace((existing) =>
          existing
            ? {
                ...existing,
                onboardingState: parsed.onboardingState,
                onboardingComplete: parsed.onboardingState === "complete",
              }
            : existing,
        );
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
        if (workspace) {
          void refreshSidebar(workspace.id);
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

  function renderConversationItem(conv: ConversationSidebarItem, depth: number = 0) {
    return (
      <li key={conv.id}>
        <button
          type="button"
          className={`sidebar-conversation-item${conv.id === activeConversationId ? " sidebar-conversation-item--active" : ""}${depth > 0 ? " sidebar-conversation-item--branch" : ""}`}
          style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
          onClick={() => onSelectConversation(conv.id)}
        >
          {depth > 0 ? "\u21b3 " : ""}{conv.title}
        </button>
        {conv.branches && conv.branches.length > 0 ? (
          <ul className="sidebar-conversation-list sidebar-branch-list">
            {conv.branches.map((branch) => renderConversationItem(branch, depth + 1))}
          </ul>
        ) : undefined}
      </li>
    );
  }

  if (!workspace) {
    return (
      <section className="workspace-setup">
        <h2>Create Workspace</h2>
        <p>Start with workspace name and owner identity. Onboarding continues in chat.</p>
        <form onSubmit={onCreateWorkspace} className="workspace-form">
          <label>
            Workspace name
            <input
              value={createWorkspaceName}
              onChange={(event) => setCreateWorkspaceName(event.target.value)}
              placeholder="Acme Labs"
              required
            />
          </label>
          <label>
            Owner display name
            <input
              value={createOwnerName}
              onChange={(event) => setCreateOwnerName(event.target.value)}
              placeholder="Marcus"
              required
            />
          </label>
          <button type="submit" disabled={!canCreateWorkspace || isCreatingWorkspace || isBootstrapping}>
            {isCreatingWorkspace ? "Creating..." : "Create Workspace"}
          </button>
        </form>
        {errorMessage ? <p className="error-message">{errorMessage}</p> : undefined}
      </section>
    );
  }

  return (
    <section className="reachat-page">
      <div className="workspace-toolbar">
        <div>
          <strong>{workspace.name}</strong>
        </div>
        <button type="button" className="seed-toggle" onClick={() => setIsSeedPanelOpen((current) => !current)}>
          {isSeedPanelOpen ? "Hide live graph seed" : "Show live graph seed"} ({seedItems.length})
        </button>
        {pendingFile ? (
          <div className="pending-file">
            Attached: {pendingFile.name}
            <button type="button" onClick={() => setPendingFile(undefined)}>
              Clear
            </button>
          </div>
        ) : undefined}
      </div>

      <div className="workspace-layout">
        <aside className="conversation-sidebar">
          <button
            type="button"
            className="sidebar-new-conversation"
            onClick={onNewConversation}
            disabled={isLoading}
          >
            New conversation
          </button>

          {sidebar?.groups.map((group) => (
            <div key={group.projectId} className="sidebar-project-group">
              <div className="sidebar-project-header">
                <span className="sidebar-project-name">{group.projectName}</span>
                <span className="sidebar-project-count">{group.conversations.length}</span>
              </div>
              {group.featureActivity.length > 0 ? (
                <div className="sidebar-feature-activity">
                  {group.featureActivity.map((feature) => (
                    <span key={feature.featureId} className="sidebar-feature-chip">
                      {feature.featureName}
                    </span>
                  ))}
                </div>
              ) : undefined}
              <ul className="sidebar-conversation-list">
                {group.conversations.map((conv) => renderConversationItem(conv))}
              </ul>
            </div>
          ))}

          {sidebar && sidebar.unlinked.length > 0 ? (
            <div className="sidebar-project-group">
              <div className="sidebar-project-header">
                <span className="sidebar-project-name sidebar-unlinked-label">Unlinked</span>
                <span className="sidebar-project-count">{sidebar.unlinked.length}</span>
              </div>
              <ul className="sidebar-conversation-list">
                {sidebar.unlinked.map((conv) => renderConversationItem(conv))}
              </ul>
            </div>
          ) : undefined}
        </aside>

        <div className={`chat-main${isSeedPanelOpen ? " chat-main--with-seeds" : ""}`}>
          <Chat
            viewType="chat"
            sessions={sessions}
            activeSessionId={activeSession.id}
            components={chatComponentCatalog}
            isLoading={isLoading}
            onSendMessage={onSendMessage}
            onStopMessage={onStopMessage}
            onFileUpload={onUploadFile}
          >
            <SessionMessagePanel>
              <SessionMessagesHeader>
                <div className="reachat-header">
                  Workspace Chat + Extraction
                </div>
              </SessionMessagesHeader>
              <SessionMessages>
                {(conversations) =>
                  conversations.map((conversation, index) => {
                    const isInherited = inheritedMessageIds.has(conversation.id);
                    const isLastInherited = isInherited
                      && index < conversations.length - 1
                      && !inheritedMessageIds.has(conversations[index + 1].id);
                    return (
                      <div
                        key={conversation.id}
                        data-message-id={conversation.id}
                        className={isInherited ? "message-inherited" : undefined}
                      >
                        <SessionMessage
                          conversation={conversation}
                          isLast={index === conversations.length - 1}
                        />
                        {!isInherited && conversation.response && workspace.onboardingState === "complete" ? (
                          <button
                            type="button"
                            className="branch-message-btn"
                            onClick={() => void onBranchFromMessage(conversation.id)}
                            disabled={isLoading || branchingFromId !== undefined}
                            title="Branch from here"
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M5 3v4.5c0 1.1.9 2 2 2h2.5M5 3L3 5M5 3l2 2M11 5v4.5c0 1.1-.9 2-2 2H6.5M11 5l-2-2M11 5l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        ) : undefined}
                        {isLastInherited ? (
                          <div className="branch-divider">Branch point</div>
                        ) : undefined}
                      </div>
                    );
                  })
                }
              </SessionMessages>
              <ChatSuggestions
                suggestions={suggestions}
                onSuggestionClick={(suggestion) => {
                  void onSendMessage(suggestion);
                }}
              />
              {workspace.onboardingState === "summary_pending" ? (
                <div className="onboarding-action-buttons">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() =>
                      void onSendMessage("Looks good, let's go.", {
                        onboardingAction: "finalize_onboarding",
                      })}
                  >
                    Looks good, let's go
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() =>
                      void onSendMessage("I want to add more.", {
                        onboardingAction: "continue_onboarding",
                      })}
                  >
                    I want to add more
                  </button>
                </div>
              ) : undefined}
              <div onClickCapture={onChatInputClickCapture}>
                <ChatInput
                  ref={chatInputRef}
                  placeholder="Discuss tasks, decisions, and questions..."
                  allowedFiles={[".md", ".txt"]}
                  mentions={{
                    onSearch: searchMentions,
                  }}
                  commands={{
                    items: COMMAND_ITEMS,
                  }}
                />
              </div>
            </SessionMessagePanel>
          </Chat>

          {isSeedPanelOpen ? (
            <aside className="seed-panel">
              <h3>Live Graph Seed</h3>
              <p>Entities extracted during onboarding and document ingestion.</p>
              <ul>
                {seedItems.map((seed) => (
                  <li key={`${seed.id}:${seed.sourceKind}:${seed.sourceId}`}>
                    <button
                      type="button"
                    >
                      <span className="seed-kind">{seed.kind}</span>
                      <span className="seed-text">{seed.text}</span>
                      <span className="seed-meta">
                        {seed.confidence.toFixed(2)} · {seed.sourceKind}
                      </span>
                      {seed.sourceLabel ? <span className="seed-label">{seed.sourceLabel}</span> : undefined}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          ) : undefined}
        </div>
      </div>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : undefined}
    </section>
  );
}
