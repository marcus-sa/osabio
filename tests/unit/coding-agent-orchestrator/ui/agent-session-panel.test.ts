import { describe, it, expect } from "bun:test";
import {
  derivePromptInputView,
  type PromptInputView,
} from "../../../../app/src/client/components/graph/AgentSessionPanel";
import {
  isTerminalStatus,
  type AgentSessionStatus,
} from "../../../../app/src/client/hooks/use-agent-session";

// ---------------------------------------------------------------------------
// Acceptance: follow-up prompt input appears, submits, and disables correctly
// ---------------------------------------------------------------------------

describe("AgentSessionPanel (acceptance)", () => {
  it("enables prompt input when session is active", () => {
    const view = derivePromptInputView({
      sessionStatus: "active",
      isSubmitting: false,
    });

    expect(view.variant).toBe("enabled");
  });

  it("enables prompt input when session is idle", () => {
    const view = derivePromptInputView({
      sessionStatus: "idle",
      isSubmitting: false,
    });

    expect(view.variant).toBe("enabled");
  });

  it("disables prompt input while a prompt is in-flight", () => {
    const view = derivePromptInputView({
      sessionStatus: "active",
      isSubmitting: true,
    });

    expect(view.variant).toBe("submitting");
  });

  it("hides prompt input for completed sessions", () => {
    const view = derivePromptInputView({
      sessionStatus: "completed",
      isSubmitting: false,
    });

    expect(view.variant).toBe("disabled");
  });

  it("hides prompt input for aborted sessions", () => {
    const view = derivePromptInputView({
      sessionStatus: "aborted",
      isSubmitting: false,
    });

    expect(view.variant).toBe("disabled");
  });

  it("hides prompt input for error sessions", () => {
    const view = derivePromptInputView({
      sessionStatus: "error",
      isSubmitting: false,
    });

    expect(view.variant).toBe("disabled");
  });

  it("disables prompt input during spawning", () => {
    const view = derivePromptInputView({
      sessionStatus: "spawning",
      isSubmitting: false,
    });

    expect(view.variant).toBe("disabled");
  });
});

// ---------------------------------------------------------------------------
// Unit: individual derivation edge cases
// ---------------------------------------------------------------------------

describe("derivePromptInputView", () => {
  it("returns submitting even for idle status when submission in-flight", () => {
    const view = derivePromptInputView({
      sessionStatus: "idle",
      isSubmitting: true,
    });

    expect(view.variant).toBe("submitting");
  });

  it("returns disabled for terminal status even when isSubmitting is true", () => {
    // Terminal status takes precedence over submission state
    const view = derivePromptInputView({
      sessionStatus: "completed",
      isSubmitting: true,
    });

    expect(view.variant).toBe("disabled");
  });
});

// ---------------------------------------------------------------------------
// DOM attribute derivation: verify the component's disabled/visibility logic
// ---------------------------------------------------------------------------
// The component derives two booleans from derivePromptInputView + isTerminalStatus:
//   inputDisabled = view.variant !== "enabled"
//   showPromptInput = !isTerminalStatus(sessionStatus)
// These directly control DOM disabled attributes and form visibility.

describe("DOM attribute derivation", () => {
  const ALL_STATUSES: AgentSessionStatus[] = [
    "spawning", "active", "idle", "completed", "aborted", "error",
  ];

  describe("input disabled attribute", () => {
    it("input is not disabled only for active/idle non-submitting sessions", () => {
      for (const status of ALL_STATUSES) {
        const view = derivePromptInputView({ sessionStatus: status, isSubmitting: false });
        const inputDisabled = view.variant !== "enabled";

        if (status === "active" || status === "idle") {
          expect(inputDisabled).toBe(false);
        } else {
          expect(inputDisabled).toBe(true);
        }
      }
    });

    it("input is disabled when submitting regardless of status", () => {
      for (const status of ALL_STATUSES) {
        const view = derivePromptInputView({ sessionStatus: status, isSubmitting: true });
        const inputDisabled = view.variant !== "enabled";

        expect(inputDisabled).toBe(true);
      }
    });
  });

  describe("prompt form visibility", () => {
    it("prompt form is hidden for terminal statuses (completed, aborted, error)", () => {
      const terminalStatuses: AgentSessionStatus[] = ["completed", "aborted", "error"];
      for (const status of terminalStatuses) {
        expect(isTerminalStatus(status)).toBe(true);
      }
    });

    it("prompt form is shown for non-terminal statuses (spawning, active, idle)", () => {
      const nonTerminalStatuses: AgentSessionStatus[] = ["spawning", "active", "idle"];
      for (const status of nonTerminalStatuses) {
        expect(isTerminalStatus(status)).toBe(false);
      }
    });
  });

  describe("abort button disabled attribute", () => {
    it("abort button is disabled for terminal statuses", () => {
      for (const status of ALL_STATUSES) {
        const abortDisabled = isTerminalStatus(status);

        if (status === "completed" || status === "aborted" || status === "error") {
          expect(abortDisabled).toBe(true);
        } else {
          expect(abortDisabled).toBe(false);
        }
      }
    });
  });
});
