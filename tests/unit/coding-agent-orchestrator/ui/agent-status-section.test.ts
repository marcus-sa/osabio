import { describe, it, expect } from "bun:test";
import {
  deriveAgentStatusView,
  type AgentStatusViewAssign,
  type AgentStatusViewActive,
} from "../../../../app/src/client/components/graph/AgentStatusSection";

// ---------------------------------------------------------------------------
// Acceptance: full lifecycle from assignable -> active -> stall warning
// ---------------------------------------------------------------------------

describe("AgentStatusSection (acceptance)", () => {
  it("shows assign button for task with ready status and no session", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "ready",
      agentSession: undefined,
    });

    expect(view.variant).toBe("assign");
  });

  it("shows assign button for task with todo status and no session", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "todo",
      agentSession: undefined,
    });

    expect(view.variant).toBe("assign");
  });

  it("shows active status when session exists", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "in_progress",
      agentSession: {
        agentSessionId: "s-1",
        orchestratorStatus: "active",
        streamId: "stream-1",
        startedAt: "2026-03-07T10:00:00Z",
        filesChangedCount: 3,
      },
    });

    expect(view.variant).toBe("active");
    const active = view as AgentStatusViewActive;
    expect(active.orchestratorStatus).toBe("active");
    expect(active.filesChangedCount).toBe(3);
    expect(active.streamUrl).toBeDefined();
    expect(active.startedAt).toBe("2026-03-07T10:00:00Z");
  });

  it("returns hidden for non-task entities", () => {
    const view = deriveAgentStatusView({
      entityKind: "decision",
      entityStatus: "proposed",
      agentSession: undefined,
    });

    expect(view.variant).toBe("hidden");
  });

  it("returns hidden for task with non-assignable status and no session", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "done",
      agentSession: undefined,
    });

    expect(view.variant).toBe("hidden");
  });
});

// ---------------------------------------------------------------------------
// Unit: individual derivation behaviors
// ---------------------------------------------------------------------------

describe("deriveAgentStatusView", () => {
  it("assigns streamUrl from session streamId", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "in_progress",
      agentSession: {
        agentSessionId: "s-1",
        orchestratorStatus: "spawning",
        streamId: "stream-abc",
        startedAt: "2026-03-07T10:00:00Z",
        filesChangedCount: 0,
      },
    });

    expect(view.variant).toBe("active");
    const active = view as AgentStatusViewActive;
    expect(active.streamUrl).toContain("stream-abc");
  });

  it("shows assign for task with ready status even with in_progress parent", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "ready",
      agentSession: undefined,
    });

    expect(view.variant).toBe("assign");
  });

  it("includes agentSessionId in active view", () => {
    const view = deriveAgentStatusView({
      entityKind: "task",
      entityStatus: "in_progress",
      agentSession: {
        agentSessionId: "session-42",
        orchestratorStatus: "idle",
        streamId: "stream-1",
        startedAt: "2026-03-07T10:00:00Z",
        filesChangedCount: 5,
      },
    });

    const active = view as AgentStatusViewActive;
    expect(active.agentSessionId).toBe("session-42");
    expect(active.orchestratorStatus).toBe("idle");
    expect(active.filesChangedCount).toBe(5);
  });
});
