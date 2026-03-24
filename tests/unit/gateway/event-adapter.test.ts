/**
 * Unit tests for the pure event adapter — maps StreamEvent to Gateway EventFrame.
 *
 * Tests all 14 StreamEvent variants:
 * - 7 mapped to EventFrames (agent_token, agent_file_change, agent_status, agent_stall_warning, agent_prompt, error, done)
 * - 7 dropped (token, reasoning, assistant_message, extraction, onboarding_seed, onboarding_state, observation)
 */
import { describe, expect, it } from "bun:test";
import { mapStreamEventToGatewayEvent } from "../../../app/src/server/gateway/event-adapter";
import type { StreamEvent } from "../../../app/src/shared/contracts";

describe("mapStreamEventToGatewayEvent", () => {
  // --- Mapped events (return EventFrame) ---

  it("maps AgentTokenEvent to assistant stream frame", () => {
    const event: StreamEvent = {
      type: "agent_token",
      sessionId: "sess-1",
      token: "hello",
    };

    const result = mapStreamEventToGatewayEvent(event, 1);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "assistant",
        data: { delta: "hello" },
      },
      seq: 1,
    });
  });

  it("maps AgentFileChangeEvent to lifecycle stream frame", () => {
    const event: StreamEvent = {
      type: "agent_file_change",
      sessionId: "sess-1",
      file: "src/main.ts",
      changeType: "modified",
    };

    const result = mapStreamEventToGatewayEvent(event, 5);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "lifecycle",
        data: {
          phase: "file_change",
          file: "src/main.ts",
          changeType: "modified",
        },
      },
      seq: 5,
    });
  });

  it("maps AgentStatusEvent to lifecycle stream frame", () => {
    const event: StreamEvent = {
      type: "agent_status",
      sessionId: "sess-1",
      status: "active",
    };

    const result = mapStreamEventToGatewayEvent(event, 3);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "lifecycle",
        data: { phase: "active" },
      },
      seq: 3,
    });
  });

  it("maps AgentStallWarningEvent to lifecycle stream frame", () => {
    const event: StreamEvent = {
      type: "agent_stall_warning",
      sessionId: "sess-1",
      lastEventAt: "2026-03-24T10:00:00Z",
      stallDurationSeconds: 120,
    };

    const result = mapStreamEventToGatewayEvent(event, 7);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "lifecycle",
        data: {
          phase: "stall_warning",
          lastEventAt: "2026-03-24T10:00:00Z",
          stallDurationSeconds: 120,
        },
      },
      seq: 7,
    });
  });

  it("maps AgentPromptEvent to lifecycle stream frame", () => {
    const event: StreamEvent = {
      type: "agent_prompt",
      sessionId: "sess-1",
      text: "Approve this action?",
    };

    const result = mapStreamEventToGatewayEvent(event, 9);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "lifecycle",
        data: { phase: "prompt" },
      },
      seq: 9,
    });
  });

  it("maps ErrorEvent to error stream frame", () => {
    const event: StreamEvent = {
      type: "error",
      messageId: "msg-1",
      error: "something went wrong",
    };

    const result = mapStreamEventToGatewayEvent(event, 11);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "error",
        data: { error: "something went wrong" },
      },
      seq: 11,
    });
  });

  it("maps DoneEvent to lifecycle done frame", () => {
    const event: StreamEvent = {
      type: "done",
      messageId: "msg-1",
    };

    const result = mapStreamEventToGatewayEvent(event, 42);

    expect(result).toEqual({
      type: "event",
      event: "agent.stream",
      payload: {
        stream: "lifecycle",
        data: { phase: "done" },
      },
      seq: 42,
    });
  });

  // --- Dropped events (return undefined) ---

  it("drops TokenEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "token",
      messageId: "msg-1",
      token: "hello",
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });

  it("drops ReasoningEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "reasoning",
      messageId: "msg-1",
      token: "thinking...",
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });

  it("drops AssistantMessageEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "assistant_message",
      messageId: "msg-1",
      text: "Hello",
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });

  it("drops ExtractionEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "extraction",
      messageId: "msg-1",
      entities: [],
      relationships: [],
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });

  it("drops OnboardingSeedEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "onboarding_seed",
      messageId: "msg-1",
      seeds: [],
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });

  it("drops OnboardingStateEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "onboarding_state",
      messageId: "msg-1",
      onboardingState: {} as any,
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });

  it("drops ObservationEvent (Brain-internal)", () => {
    const event: StreamEvent = {
      type: "observation",
      messageId: "msg-1",
      action: "created",
      observation: {} as any,
    };
    expect(mapStreamEventToGatewayEvent(event, 1)).toBeUndefined();
  });
});
