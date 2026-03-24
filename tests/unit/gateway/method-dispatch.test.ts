/**
 * Unit tests for the method-dispatch pure routing table.
 *
 * The dispatch function maps MethodName to handler functions.
 * Unknown or unsupported methods return method_not_supported.
 */
import { describe, expect, it } from "bun:test";
import {
  createMethodDispatch,
  type MethodHandler,
  type MethodHandlerContext,
} from "../../../app/src/server/gateway/method-dispatch";
import type { GatewayConnection } from "../../../app/src/server/gateway/types";

// ---------------------------------------------------------------------------
// Stub handler factory
// ---------------------------------------------------------------------------

function stubHandler(name: string): MethodHandler {
  return async (_conn, _params, _deps) => ({
    ok: true as const,
    payload: { handler: name },
  });
}

function stubConnection(overrides?: Partial<GatewayConnection>): GatewayConnection {
  return {
    connectionId: "test-conn-id",
    state: "active",
    createdAt: Date.now(),
    seqCounter: 0,
    activeSessions: new Set(),
    ...overrides,
  };
}

const stubDeps = {} as MethodHandlerContext["deps"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMethodDispatch", () => {
  const connectHandler = stubHandler("connect");
  const agentHandler = stubHandler("agent");

  const dispatch = createMethodDispatch({
    connect: connectHandler,
    agent: agentHandler,
  });

  it("routes 'connect' to the connect handler", async () => {
    const result = await dispatch("connect", stubConnection(), {}, stubDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload as { handler: string }).handler).toBe("connect");
    }
  });

  it("routes 'agent' to the agent handler", async () => {
    const result = await dispatch("agent", stubConnection(), {}, stubDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload as { handler: string }).handler).toBe("agent");
    }
  });

  it("returns method_not_supported for unknown methods", async () => {
    const result = await dispatch(
      "sessions.list" as any,
      stubConnection(),
      {},
      stubDeps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("method_not_supported");
    }
  });

  it("returns method_not_supported for unregistered methods", async () => {
    const result = await dispatch(
      "tools.catalog" as any,
      stubConnection(),
      {},
      stubDeps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("method_not_supported");
    }
  });
});
