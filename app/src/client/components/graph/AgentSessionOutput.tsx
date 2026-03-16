/**
 * AgentSessionOutput -- renders accumulated agent output as streaming text
 * with inline file change notifications.
 *
 * Pure presentational component. All state managed by useAgentSession hook.
 * Auto-scrolls to latest content while streaming is active.
 */

import { useEffect, useRef } from "react";
import type { OutputEntry } from "../../hooks/use-agent-session";
import { isTerminalStatus, type AgentSessionStatus } from "../../hooks/use-agent-session";

// ---------------------------------------------------------------------------
// Pure core: derive display text from output entries
// ---------------------------------------------------------------------------

export function renderTokenText(entries: OutputEntry[]): string {
  return entries
    .filter((e): e is Extract<OutputEntry, { kind: "token" }> => e.kind === "token")
    .map((e) => e.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentSessionOutput({
  outputEntries,
  status,
}: {
  outputEntries: OutputEntry[];
  status: AgentSessionStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isStreaming = !isTerminalStatus(status) && status !== "idle";

  // Auto-scroll to bottom when new entries arrive during active streaming
  useEffect(() => {
    if (isStreaming && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [outputEntries.length, isStreaming]);

  if (outputEntries.length === 0) {
    return (
      <div
        className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted p-3 font-mono text-xs"
        data-testid="agent-session-output"
      >
        <p className="text-muted-foreground">
          Waiting for agent output...
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      data-testid="agent-session-output"
    >
      {outputEntries.map((entry, index) => {
        switch (entry.kind) {
          case "token":
            return (
              <span
                key={index}
                className="text-foreground"
                data-testid="agent-output-token"
              >
                {entry.text}
              </span>
            );
          case "file_change":
            return (
              <div
                key={index}
                className="my-1 flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[0.7rem]"
                data-testid="agent-output-file-change"
              >
                <span className="font-bold text-accent">
                  {entry.changeType === "created"
                    ? "+"
                    : entry.changeType === "deleted"
                      ? "-"
                      : "~"}
                </span>
                <span className="text-muted-foreground">
                  {entry.file}
                </span>
              </div>
            );
          case "prompt":
            return (
              <div
                key={index}
                className="my-1 rounded border-l-2 border-ring bg-background px-2 py-1 text-ring"
                data-testid="agent-output-prompt"
              >
                {entry.text}
              </div>
            );
        }
      })}
    </div>
  );
}
