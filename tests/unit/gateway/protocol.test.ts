/**
 * Unit tests for gateway protocol frame parsing and serialization.
 *
 * These are pure functions with no side effects — ideal for property-like
 * exhaustive example coverage across all frame discriminants.
 */
import { describe, expect, it } from "bun:test";
import {
  parseFrame,
  serializeFrame,
  isParseError,
  type GatewayFrame,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
} from "../../../app/src/server/gateway/protocol";

describe("parseFrame", () => {
  it("parses a valid request frame", () => {
    const raw = JSON.stringify({
      type: "req",
      id: "abc-123",
      method: "connect",
      params: { token: "test" },
    });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(false);

    const frame = result as RequestFrame;
    expect(frame.type).toBe("req");
    expect(frame.id).toBe("abc-123");
    expect(frame.method).toBe("connect");
    expect(frame.params).toEqual({ token: "test" });
  });

  it("parses a request frame without optional params", () => {
    const raw = JSON.stringify({ type: "req", id: "x", method: "presence" });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(false);

    const frame = result as RequestFrame;
    expect(frame.type).toBe("req");
    expect(frame.params).toBeUndefined();
  });

  it("parses a successful response frame", () => {
    const raw = JSON.stringify({
      type: "res",
      id: "r-1",
      ok: true,
      payload: { runId: "run-abc" },
    });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(false);

    const frame = result as ResponseFrame;
    expect(frame.type).toBe("res");
    expect(frame.id).toBe("r-1");
    expect(frame.ok).toBe(true);
    expect(frame.payload).toEqual({ runId: "run-abc" });
  });

  it("parses an error response frame", () => {
    const raw = JSON.stringify({
      type: "res",
      id: "r-2",
      ok: false,
      error: { code: "auth_failed", message: "bad token" },
    });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(false);

    const frame = result as ResponseFrame;
    expect(frame.type).toBe("res");
    expect(frame.ok).toBe(false);
    if (!frame.ok) {
      expect(frame.error.code).toBe("auth_failed");
      expect(frame.error.message).toBe("bad token");
    }
  });

  it("parses an event frame with seq", () => {
    const raw = JSON.stringify({
      type: "event",
      event: "agent.stream",
      payload: { stream: "assistant", delta: "hello" },
      seq: 42,
    });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(false);

    const frame = result as EventFrame;
    expect(frame.type).toBe("event");
    expect(frame.event).toBe("agent.stream");
    expect(frame.seq).toBe(42);
  });

  it("parses an event frame without optional fields", () => {
    const raw = JSON.stringify({ type: "event", event: "heartbeat" });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(false);

    const frame = result as EventFrame;
    expect(frame.type).toBe("event");
    expect(frame.payload).toBeUndefined();
    expect(frame.seq).toBeUndefined();
  });

  it("returns error for invalid JSON", () => {
    const result = parseFrame("not-json{");
    expect(isParseError(result)).toBe(true);
    expect((result as { parseError: string }).parseError).toContain("parse");
  });

  it("returns error for unknown frame type", () => {
    const raw = JSON.stringify({ type: "unknown", id: "x" });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(true);
    expect((result as { parseError: string }).parseError).toContain("type");
  });

  it("returns error for request frame missing id", () => {
    const raw = JSON.stringify({ type: "req", method: "connect" });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(true);
  });

  it("returns error for request frame missing method", () => {
    const raw = JSON.stringify({ type: "req", id: "x" });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(true);
  });

  it("returns error for response frame missing id", () => {
    const raw = JSON.stringify({ type: "res", ok: true });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(true);
  });

  it("returns error for event frame missing event name", () => {
    const raw = JSON.stringify({ type: "event" });
    const result = parseFrame(raw);
    expect(isParseError(result)).toBe(true);
  });
});

describe("serializeFrame", () => {
  it("roundtrips a request frame", () => {
    const frame: RequestFrame = {
      type: "req",
      id: "rt-1",
      method: "agent",
      params: { task: "do stuff" },
    };
    const serialized = serializeFrame(frame);
    const parsed = parseFrame(serialized);
    expect("error" in parsed).toBe(false);
    expect(parsed).toEqual(frame);
  });

  it("roundtrips a successful response frame", () => {
    const frame: ResponseFrame = {
      type: "res",
      id: "rt-2",
      ok: true,
      payload: { sessionId: "s-1" },
    };
    const serialized = serializeFrame(frame);
    const parsed = parseFrame(serialized);
    expect("error" in parsed).toBe(false);
    expect(parsed).toEqual(frame);
  });

  it("roundtrips an error response frame", () => {
    const frame: ResponseFrame = {
      type: "res",
      id: "rt-3",
      ok: false,
      error: { code: "invalid_frame", message: "missing field" },
    };
    const serialized = serializeFrame(frame);
    const parsed = parseFrame(serialized);
    expect(isParseError(parsed)).toBe(false);
    expect(parsed).toEqual(frame);
  });

  it("roundtrips an event frame", () => {
    const frame: EventFrame = {
      type: "event",
      event: "agent.stream",
      payload: { stream: "lifecycle", data: { phase: "done" } },
      seq: 7,
    };
    const serialized = serializeFrame(frame);
    const parsed = parseFrame(serialized);
    expect("error" in parsed).toBe(false);
    expect(parsed).toEqual(frame);
  });
});
