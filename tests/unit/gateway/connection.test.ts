/**
 * Connection state machine — unit tests for pure transition function.
 *
 * Tests the connection lifecycle: creation, state transitions, and effect generation.
 * All functions under test are pure — no IO, no side effects.
 */
import { describe, expect, it } from "bun:test";
import {
  createConnection,
  transition,
  type ConnectionEvent,
} from "../../../app/src/server/gateway/connection";

describe("Connection State Machine", () => {
  describe("createConnection", () => {
    it("creates a connection in connecting state with unique id", () => {
      const connection = createConnection();

      expect(connection.state).toBe("connecting");
      expect(connection.connectionId).toBeDefined();
      expect(typeof connection.connectionId).toBe("string");
      expect(connection.connectionId.length).toBeGreaterThan(0);
      expect(connection.seqCounter).toBe(0);
      expect(connection.activeSessions.size).toBe(0);
      expect(connection.createdAt).toBeGreaterThan(0);
    });

    it("generates distinct connection ids", () => {
      const first = createConnection();
      const second = createConnection();

      expect(first.connectionId).not.toBe(second.connectionId);
    });
  });

  describe("transition from connecting", () => {
    it("transitions to authenticating on ws_open event", () => {
      const connection = createConnection();
      const event: ConnectionEvent = { type: "ws_open", challenge: { nonce: "dGVzdC1ub25jZQ==", ts: Date.now() } };

      const result = transition(connection, event);

      expect(result.connection.state).toBe("authenticating");
      expect(result.connection.connectionId).toBe(connection.connectionId);
    });

    it("produces record_trace effect on ws_open", () => {
      const connection = createConnection();
      const event: ConnectionEvent = { type: "ws_open", challenge: { nonce: "dGVzdC1ub25jZQ==", ts: Date.now() } };

      const result = transition(connection, event);

      const traceEffects = result.effects.filter(
        (e) => e.type === "record_trace",
      );
      expect(traceEffects.length).toBe(1);
    });

    it("transitions to closed on ws_close from connecting", () => {
      const connection = createConnection();
      const event: ConnectionEvent = { type: "ws_close", code: 1000, reason: "normal" };

      const result = transition(connection, event);

      expect(result.connection.state).toBe("closed");
    });
  });

  describe("transition from authenticating", () => {
    it("transitions to closed on ws_close", () => {
      const connection = createConnection();
      const opened = transition(connection, { type: "ws_open", challenge: { nonce: "dGVzdC1ub25jZQ==", ts: Date.now() } });
      const event: ConnectionEvent = { type: "ws_close", code: 1000, reason: "going away" };

      const result = transition(opened.connection, event);

      expect(result.connection.state).toBe("closed");
    });
  });

  describe("transition from closed", () => {
    it("remains closed on any event (terminal state)", () => {
      const connection = createConnection();
      const closed = transition(connection, { type: "ws_close", code: 1000, reason: "done" });

      const result = transition(closed.connection, { type: "ws_open", challenge: { nonce: "dGVzdC1ub25jZQ==", ts: Date.now() } });

      expect(result.connection.state).toBe("closed");
      expect(result.effects).toEqual([]);
    });
  });
});
