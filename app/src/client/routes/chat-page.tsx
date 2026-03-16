import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMatch, useSearch } from "@tanstack/react-router";
import Markdown from "react-markdown";
import { ChatSuggestionPills } from "../components/chat/ChatSuggestionPills";
import { DiscussEntityCard } from "../components/chat/DiscussEntityCard";
import { EntityLink } from "../components/chat/EntityLink";
import { SuggestionToolCard } from "../components/chat/SuggestionToolCard";
import type { DiscussEntitySummary, SubagentTrace } from "../../shared/contracts";
import { useWorkspaceState } from "../stores/workspace-state";
import { useChatSession } from "../hooks/use-chat-session";
import { useGovernanceFeed } from "../hooks/use-governance-feed";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "@/lib/utils";

export function ChatPage() {
  const onboardingState = useWorkspaceState((s) => s.onboardingState);
  const setSidebarHandlers = useWorkspaceState((s) => s.setSidebarHandlers);

  const matchWithId = useMatch({ from: "/authenticated/chat/$conversationId", shouldThrow: false });
  const routeConversationId = matchWithId?.params.conversationId;

  const search = useSearch({ strict: false });
  const messageParam = (search as { message?: string })?.message;

  const chat = useChatSession(routeConversationId);
  const { feed } = useGovernanceFeed();

  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
    setSidebarHandlers({
      activeConversationId: chat.activeConversationId,
      isLoading: chat.isLoading,
      onNewConversation: () => chatRef.current.newConversation(),
      onSelectConversation: (id: string) => chatRef.current.selectConversation(id),
    });
  }, [chat.activeConversationId, chat.isLoading]);

  useEffect(() => {
    return () => { setSidebarHandlers(undefined); };
  }, []);

  useEffect(() => {
    if (routeConversationId && routeConversationId !== chat.activeConversationId) {
      chat.selectConversation(routeConversationId);
    } else if (!routeConversationId && chat.activeConversationId) {
      chat.resetChat();
    }
  }, [routeConversationId]);

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messageParam) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  return (
    <section className="flex h-full flex-col">
      {(chat.discussEntity ?? chat.conversationDiscussEntity) ? (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <DiscussEntityCard
            entity={(chat.discussEntity ?? chat.conversationDiscussEntity) as DiscussEntitySummary}
          />
        </div>
      ) : undefined}

      <div className="flex-1 overflow-y-auto px-4 py-4">
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
            className={cn(
              "group mb-4 flex flex-col gap-1",
              message.role === "user" && "items-end",
            )}
          >
            {message.role === "user" ? (
              <span className="text-[0.65rem] font-medium text-muted-foreground">You</span>
            ) : undefined}
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                      message.role === "user"
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-foreground",
                      "[&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:rounded-md [&_pre]:bg-background [&_pre]:p-3 [&_pre]:text-xs [&_code]:text-accent [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-ring [&_a]:underline",
                    )}
                  >
                    <Markdown components={{ a: EntityLink }}>{part.text}</Markdown>
                  </div>
                );
              }
              if (part.type === "reasoning") {
                return (
                  <details key={i} className="max-w-[80%] rounded-lg border border-border bg-muted/50 text-xs">
                    <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">Thinking</summary>
                    <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-2 text-muted-foreground">{part.text}</pre>
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

                if (toolName === "invoke_pm_agent" && toolPart.state === "output-available") {
                  const trace = (toolPart.output as Record<string, unknown> | undefined)?.trace as SubagentTrace | undefined;
                  if (trace) {
                    return (
                      <details key={i} className="max-w-[80%] rounded-lg border border-border bg-muted/50 text-xs">
                        <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">
                          PM Agent — {trace.intent.replace(/_/g, " ")} ({trace.steps.filter(s => s.type === "tool_call").length} tools, {(trace.totalDurationMs / 1000).toFixed(1)}s)
                        </summary>
                        <div className="flex flex-col gap-1 px-3 py-2">
                          {trace.steps.map((step, j) => {
                            if (step.type === "text") {
                              return <div key={j} className="text-foreground">{step.text}</div>;
                            }
                            return (
                              <details key={j} className="rounded border border-border bg-background">
                                <summary className="flex items-center gap-2 px-2 py-1 text-muted-foreground">
                                  <span className="font-mono text-accent">{step.toolName}</span>
                                  {step.durationMs ? <span className="text-[0.6rem]">{step.durationMs}ms</span> : undefined}
                                </summary>
                                <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border px-2 py-1 text-muted-foreground">{step.argsJson}</pre>
                                <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border px-2 py-1 text-muted-foreground">{step.resultJson}</pre>
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    );
                  }
                }

                return (
                  <div key={i} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
                    <Badge variant="secondary" className="font-mono text-[0.6rem]">{toolName}</Badge>
                    {toolPart.state === "output-available" ? (
                      <span className="text-entity-feature-fg">Done</span>
                    ) : (
                      <span className="animate-pulse text-entity-decision-fg">Running...</span>
                    )}
                  </div>
                );
              }
              return undefined;
            })}
            {message.role === "assistant" ? (
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => void chat.branchFromMessage(message.id)}
                disabled={chat.isLoading || chat.branchingFromId !== undefined}
                title="Branch from here"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M5 3v4.5c0 1.1.9 2 2 2h2.5M5 3L3 5M5 3l2 2M11 5v4.5c0 1.1-.9 2-2 2H6.5M11 5l-2-2M11 5l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Button>
            ) : undefined}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {onboardingState === "summary_pending" ? (
        <div className="flex gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" disabled={chat.isLoading} onClick={() =>
            chat.sendMessage("Looks good, let's go.", { onboardingAction: "finalize_onboarding" })}>
            Looks good, let's go
          </Button>
          <Button variant="outline" disabled={chat.isLoading} onClick={() =>
            chat.sendMessage("I want to add more.", { onboardingAction: "continue_onboarding" })}>
            I want to add more
          </Button>
        </div>
      ) : undefined}

      <ChatInput
        onSend={chat.sendMessage}
        disabled={chat.isLoading}
        onStop={chat.stopMessage}
        isStreaming={chat.status === "streaming"}
      />

      {chat.errorMessage ? <p className="px-4 pb-2 text-sm text-destructive">{chat.errorMessage}</p> : undefined}
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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  return (
    <div className="flex items-end gap-2 border-t border-border bg-card px-4 py-3">
      <textarea
        ref={textareaRef}
        className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Discuss tasks, decisions, and questions..."
        rows={1}
        disabled={disabled && !isStreaming}
      />
      {isStreaming ? (
        <Button variant="destructive" size="sm" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button size="sm" onClick={handleSubmit} disabled={disabled || input.trim().length === 0}>
          Send
        </Button>
      )}
    </div>
  );
}
