/**
 * AgentSessionPanel -- composite panel for active agent sessions.
 *
 * Renders agent output, follow-up prompt input, and abort button.
 * Pure core: derivePromptInputView determines input state from session status.
 * Effect boundary: the component wires sendPrompt and abortSession API calls.
 */

import { useState } from "react";
import type { AgentSessionStatus, OutputEntry } from "../../hooks/use-agent-session";
import { isTerminalStatus } from "../../hooks/use-agent-session";
import { AgentSessionOutput } from "./AgentSessionOutput";
import { sendPrompt, abortSession } from "../../graph/orchestrator-api";

// ---------------------------------------------------------------------------
// Pure core: prompt input view derivation
// ---------------------------------------------------------------------------

const PROMPTABLE_STATUSES = new Set<AgentSessionStatus>(["active", "idle"]);

export type PromptInputEnabled = { variant: "enabled" };
export type PromptInputSubmitting = { variant: "submitting" };
export type PromptInputDisabled = { variant: "disabled" };

export type PromptInputView =
  | PromptInputEnabled
  | PromptInputSubmitting
  | PromptInputDisabled;

export type DerivePromptInputArgs = {
  sessionStatus: AgentSessionStatus;
  isSubmitting: boolean;
};

export function derivePromptInputView(args: DerivePromptInputArgs): PromptInputView {
  if (!PROMPTABLE_STATUSES.has(args.sessionStatus)) {
    return { variant: "disabled" };
  }

  if (args.isSubmitting) {
    return { variant: "submitting" };
  }

  return { variant: "enabled" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentSessionPanel({
  workspaceId,
  agentSessionId,
  sessionStatus,
  outputEntries,
  stallWarning,
  connectionError,
}: {
  workspaceId: string;
  agentSessionId: string;
  sessionStatus: AgentSessionStatus;
  outputEntries: OutputEntry[];
  stallWarning?: { lastEventAt: string; stallDurationSeconds: number };
  connectionError?: string;
}) {
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [promptError, setPromptError] = useState<string | undefined>();
  const [isAborting, setIsAborting] = useState(false);

  const inputView = derivePromptInputView({ sessionStatus, isSubmitting });
  const inputDisabled = inputView.variant !== "enabled";
  const showPromptInput = !isTerminalStatus(sessionStatus);

  async function handleSubmitPrompt(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = promptText.trim();
    if (!trimmed || inputDisabled) return;

    setIsSubmitting(true);
    setPromptError(undefined);
    try {
      await sendPrompt(workspaceId, agentSessionId, trimmed);
      setPromptText("");
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to send prompt");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAbort() {
    if (isAborting) return;
    setIsAborting(true);
    try {
      await abortSession(workspaceId, agentSessionId);
    } catch {
      // Abort errors are non-critical -- session may already be terminal
    } finally {
      setIsAborting(false);
    }
  }

  return (
    <div className="agent-session-panel" data-testid="agent-session-panel">
      <AgentSessionOutput
        outputEntries={outputEntries}
        status={sessionStatus}
      />

      {stallWarning ? (
        <p className="agent-stall-warning" data-testid="agent-stall-warning">
          Agent may be stalled (no activity for {stallWarning.stallDurationSeconds}s)
        </p>
      ) : undefined}

      {connectionError ? (
        <p className="agent-connection-error">{connectionError}</p>
      ) : undefined}

      {showPromptInput ? (
        <form
          className="agent-prompt-form"
          data-testid="agent-prompt-form"
          onSubmit={handleSubmitPrompt}
        >
          <input
            type="text"
            className="agent-prompt-input"
            data-testid="agent-prompt-input"
            placeholder="Send follow-up instruction..."
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            disabled={inputDisabled}
          />
          <button
            type="submit"
            className="agent-prompt-submit"
            data-testid="agent-prompt-submit"
            disabled={inputDisabled || promptText.trim().length === 0}
          >
            {inputView.variant === "submitting" ? "Sending..." : "Send"}
          </button>
          <button
            type="button"
            className="agent-abort-button"
            data-testid="agent-abort-button"
            disabled={isAborting || isTerminalStatus(sessionStatus)}
            onClick={handleAbort}
          >
            {isAborting ? "Aborting..." : "Abort"}
          </button>
        </form>
      ) : (
        <div className="agent-session-panel__terminal-actions">
          <button
            type="button"
            className="agent-abort-button"
            data-testid="agent-abort-button"
            disabled={true}
          >
            Abort
          </button>
        </div>
      )}

      {promptError ? (
        <p className="agent-prompt-error" data-testid="agent-prompt-error">{promptError}</p>
      ) : undefined}
    </div>
  );
}
