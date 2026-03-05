import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMatch, useSearch } from "@tanstack/react-router";
import Markdown from "react-markdown";
import { ChatSuggestionPills } from "../components/chat/ChatSuggestionPills";
import { DiscussEntityCard } from "../components/chat/DiscussEntityCard";
import { EntityLink } from "../components/chat/EntityLink";
import { SuggestionToolCard } from "../components/chat/SuggestionToolCard";
import type { DiscussEntitySummary } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";
import { useChatSession } from "../hooks/use-chat-session";
import { useGovernanceFeed } from "../hooks/use-governance-feed";

export function ChatPage() {
  const onboardingState = useWorkspaceState((s) => s.onboardingState);
  const setSidebarHandlers = useWorkspaceState((s) => s.setSidebarHandlers);

  // Read conversationId from /chat/$conversationId route (undefined on /chat)
  const matchWithId = useMatch({ from: "/authenticated/chat/$conversationId", shouldThrow: false });
  const routeConversationId = matchWithId?.params.conversationId;

  // Read message search param (works on both /chat and /chat/:id)
  const search = useSearch({ strict: false });
  const messageParam = (search as { message?: string })?.message;

  const chat = useChatSession(routeConversationId);
  const { feed } = useGovernanceFeed();

  // Keep a ref to the latest chat handlers so the effect below doesn't
  // depend on unstable function references.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Register sidebar handlers so the shell sidebar can interact with chat
  useEffect(() => {
    setSidebarHandlers({
      activeConversationId: chat.activeConversationId,
      isLoading: chat.isLoading,
      onNewConversation: () => chatRef.current.newConversation(),
      onSelectConversation: (id: string) => chatRef.current.selectConversation(id),
    });
  }, [chat.activeConversationId, chat.isLoading]);

  // Cleanup sidebar handlers on unmount
  useEffect(() => {
    return () => {
      setSidebarHandlers(undefined);
    };
  }, []);

  // Load conversation from URL param on mount/param change
  useEffect(() => {
    if (routeConversationId && routeConversationId !== chat.activeConversationId) {
      chat.selectConversation(routeConversationId);
    } else if (!routeConversationId && chat.activeConversationId) {
      // Navigated from /chat/:id to /chat (e.g., discuss on new chat)
      chat.resetChat();
    }
  }, [routeConversationId]);

  // Scroll to message from ?message= search param
  useEffect(() => {
    if (!messageParam) return;

    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-message-id="${CSS.escape(messageParam)}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("animate-highlight");
        element.addEventListener("animationend", () => {
          element.classList.remove("animate-highlight");
        }, { once: true });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [messageParam, chat.messages]);

  // Auto-scroll to bottom (skip when targeting a specific message)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messageParam) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  return (
    <section className="chat-page">
      {(chat.discussEntity ?? chat.conversationDiscussEntity) ? (
        <DiscussEntityCard
          entity={(chat.discussEntity ?? chat.conversationDiscussEntity) as DiscussEntitySummary}
        />
      ) : undefined}

      <div className="chat-messages">
        {chat.messages.length === 0
          && onboardingState === "complete"
          && !chat.discussEntity
          && !chat.conversationDiscussEntity ? (
          <ChatSuggestionPills feed={feed} />
        ) : undefined}
        {chat.messages.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            className={`chat-message chat-message--${message.role}`}
          >
            {message.role === "user" ? (
              <div className="chat-message-label">You</div>
            ) : undefined}
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div key={i} className="chat-message-text">
                    <Markdown components={{ a: EntityLink }}>{part.text}</Markdown>
                  </div>
                );
              }
              if (part.type === "reasoning") {
                return (
                  <details key={i} className="thinking-block">
                    <summary>Thinking</summary>
                    <pre className="thinking-content">{part.text}</pre>
                  </details>
                );
              }
              if (isToolPart(part)) {
                const toolPart = part as { type: string; state: string; output?: unknown };
                const toolName = toolPart.type.replace(/^tool-/, "");

                if (toolName === "create_suggestion" && toolPart.state === "output-available" && toolPart.output) {
                  const output = toolPart.output as { text: string; category: string; confidence: number; rationale: string; target?: string };
                  return <SuggestionToolCard key={i} output={output} />;
                }

                return (
                  <div key={i} className="chat-tool-invocation">
                    <span className="chat-tool-name">{toolName}</span>
                    {toolPart.state === "output-available" ? (
                      <span className="chat-tool-status">Done</span>
                    ) : (
                      <span className="chat-tool-status chat-tool-status--running">Running...</span>
                    )}
                  </div>
                );
              }
              return undefined;
            })}
            {message.role === "assistant" ? (
              <button
                type="button"
                className="branch-message-btn"
                onClick={() => void chat.branchFromMessage(message.id)}
                disabled={chat.isLoading || chat.branchingFromId !== undefined}
                title="Branch from here"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M5 3v4.5c0 1.1.9 2 2 2h2.5M5 3L3 5M5 3l2 2M11 5v4.5c0 1.1-.9 2-2 2H6.5M11 5l-2-2M11 5l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ) : undefined}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {onboardingState === "summary_pending" ? (
        <div className="onboarding-action-buttons">
          <button
            type="button"
            disabled={chat.isLoading}
            onClick={() =>
              chat.sendMessage("Looks good, let's go.", {
                onboardingAction: "finalize_onboarding",
              })}
          >
            Looks good, let's go
          </button>
          <button
            type="button"
            disabled={chat.isLoading}
            onClick={() =>
              chat.sendMessage("I want to add more.", {
                onboardingAction: "continue_onboarding",
              })}
          >
            I want to add more
          </button>
        </div>
      ) : undefined}

      <ChatInput
        onSend={chat.sendMessage}
        disabled={chat.isLoading}
        onStop={chat.stopMessage}
        isStreaming={chat.status === "streaming"}
      />

      {chat.errorMessage ? <p className="error-message">{chat.errorMessage}</p> : undefined}
    </section>
  );
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-");
}

function ChatInput({
  onSend,
  disabled,
  onStop,
  isStreaming,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  onStop: () => void;
  isStreaming: boolean;
}) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  return (
    <div className="chat-input-container">
      <textarea
        ref={textareaRef}
        className="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Discuss tasks, decisions, and questions..."
        rows={1}
        disabled={disabled && !isStreaming}
      />
      {isStreaming ? (
        <button
          type="button"
          className="chat-input-btn chat-input-btn--stop"
          onClick={onStop}
          title="Stop"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="chat-input-btn chat-input-btn--send"
          onClick={handleSubmit}
          disabled={disabled || input.trim().length === 0}
          title="Send"
        >
          Send
        </button>
      )}
    </div>
  );
}
