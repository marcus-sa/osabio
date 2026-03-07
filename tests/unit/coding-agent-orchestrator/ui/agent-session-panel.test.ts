import { describe, it, expect } from "bun:test";
import {
  derivePromptInputView,
  type PromptInputView,
} from "../../../../app/src/client/components/graph/AgentSessionPanel";

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
