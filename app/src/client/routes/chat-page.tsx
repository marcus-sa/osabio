import { useEffect, useRef } from "react";
import {
  Chat,
  ChatSuggestions,
  ChatInput,
  SessionMessage,
  SessionMessagePanel,
  SessionMessages,
  type SlashCommandItem,
} from "reachat";
import { chatComponentCatalog } from "../chat-component-catalog";
import { darkChatTheme } from "../chat-theme";
import { DiscussEntityCard } from "../components/chat/DiscussEntityCard";
import type { DiscussEntitySummary } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";
import { useChatSession } from "../hooks/use-chat-session";

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

export function ChatPage() {
  const onboardingState = useWorkspaceState((s) => s.onboardingState);
  const setSidebarHandlers = useWorkspaceState((s) => s.setSidebarHandlers);

  const chat = useChatSession();

  // Keep a ref to the latest chat handlers so the effect below doesn't
  // depend on unstable function references (which would cause an infinite
  // render loop: new fn refs → effect fires → setSidebarHandlers → zustand
  // update → AppShell re-renders → ChatPage re-renders → new fn refs → …).
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Register sidebar handlers so the shell sidebar can interact with chat
  useEffect(() => {
    setSidebarHandlers({
      activeConversationId: chat.activeConversationId,
      isLoading: chat.isLoading,
      onNewConversation: () => chatRef.current.onNewConversation(),
      onSelectConversation: (id: string) => chatRef.current.onSelectConversation(id),
    });
  }, [chat.activeConversationId, chat.isLoading]);

  // Cleanup sidebar handlers on unmount
  useEffect(() => {
    return () => {
      setSidebarHandlers(undefined);
    };
  }, []);

  return (
    <section className="reachat-page">
      {chat.pendingFile ? (
        <div className="workspace-toolbar">
          <div className="pending-file">
            Attached: {chat.pendingFile.name}
            <button type="button" onClick={() => chat.onUploadFile(undefined as unknown as File)}>
              Clear
            </button>
          </div>
        </div>
      ) : undefined}

      {(chat.discussEntity ?? chat.conversationDiscussEntity) ? (
        <DiscussEntityCard
          entity={(chat.discussEntity ?? chat.conversationDiscussEntity) as DiscussEntitySummary}
        />
      ) : undefined}

      <div className="chat-main">
        <Chat
          viewType="chat"
          theme={darkChatTheme}
          sessions={chat.sessions}
          activeSessionId={chat.activeSession.id}
          components={chatComponentCatalog}
          isLoading={chat.isLoading}
          onSendMessage={chat.onSendMessage}
          onStopMessage={chat.onStopMessage}
          onFileUpload={chat.onUploadFile}
        >
          <SessionMessagePanel>
            <SessionMessages>
              {(conversations) =>
                conversations.map((conversation, index) => {
                  const isInherited = chat.inheritedMessageIds.has(conversation.id);
                  const isLastInherited = isInherited
                    && index < conversations.length - 1
                    && !chat.inheritedMessageIds.has(conversations[index + 1].id);
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
                      {!isInherited && conversation.response && onboardingState === "complete" ? (
                        <button
                          type="button"
                          className="branch-message-btn"
                          onClick={() => void chat.onBranchFromMessage(conversation.id)}
                          disabled={chat.isLoading || chat.branchingFromId !== undefined}
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
              suggestions={chat.suggestions}
              onSuggestionClick={(suggestion) => {
                void chat.onSendMessage(suggestion);
              }}
            />
            {onboardingState === "summary_pending" ? (
              <div className="onboarding-action-buttons">
                <button
                  type="button"
                  disabled={chat.isLoading}
                  onClick={() =>
                    void chat.onSendMessage("Looks good, let's go.", {
                      onboardingAction: "finalize_onboarding",
                    })}
                >
                  Looks good, let's go
                </button>
                <button
                  type="button"
                  disabled={chat.isLoading}
                  onClick={() =>
                    void chat.onSendMessage("I want to add more.", {
                      onboardingAction: "continue_onboarding",
                    })}
                >
                  I want to add more
                </button>
              </div>
            ) : undefined}
            <div onClickCapture={chat.onChatInputClickCapture}>
              <ChatInput
                ref={chat.chatInputRef}
                placeholder="Discuss tasks, decisions, and questions..."
                allowedFiles={[".md", ".txt"]}
                mentions={{
                  onSearch: chat.searchMentions,
                }}
                commands={{
                  items: COMMAND_ITEMS,
                }}
              />
            </div>
          </SessionMessagePanel>
        </Chat>

      </div>

      {chat.errorMessage ? <p className="error-message">{chat.errorMessage}</p> : undefined}
    </section>
  );
}
