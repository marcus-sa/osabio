/**
 * Unit tests for SandboxAgentAdapter interface.
 *
 * Tests use a mock adapter implementation -- no real SDK, no real SandboxAgent Server.
 * Validates the adapter contract: method signatures, return types, error propagation.
 *
 * Traces: US-01 (spawn), US-04 (prompt), US-05 (resume)
 *
 * Driving port: SandboxAgentAdapter type (injected mock)
 */
import { describe, expect, it } from "bun:test";
import { createMockAdapter } from "../../../app/src/server/orchestrator/sandbox-adapter";

// ── Tests ──

describe("SandboxAgentAdapter (mock)", () => {
  // ─── UA-1: createSession returns a SessionHandle with valid ID ───
  // US-01
  it("createSession returns a session handle with a valid ID", async () => {
    // Given a mock sandbox adapter
    const adapter = createMockAdapter();

    // When a session is created with agent and working directory
    const handle = await adapter.createSession({
      agent: "claude",
      cwd: "/workspace/rate-limiter",
    });

    // Then the handle has a non-empty ID
    expect(handle.id).toBeTruthy();
    expect(typeof handle.id).toBe("string");
    // And the handle exposes prompt, onEvent, and respondPermission methods
    expect(typeof handle.prompt).toBe("function");
    expect(typeof handle.onEvent).toBe("function");
    expect(typeof handle.respondPermission).toBe("function");
  });

  // ─── UA-2: prompt delivers messages and returns result ───
  // US-04
  it("prompt delivers messages to an active session", async () => {
    // Given an active session
    const adapter = createMockAdapter();
    const handle = await adapter.createSession({
      agent: "claude",
      cwd: "/workspace/feature",
    });

    // When a prompt is sent
    const result = await handle.prompt([
      { type: "text", text: "Implement rate limiting with a sliding window" },
    ]);

    // Then the prompt succeeds
    expect(result.success).toBe(true);
  });

  // ─── UA-3: destroySession completes without error ───
  // US-01
  it("destroySession completes without error for an existing session", async () => {
    // Given an active session
    const adapter = createMockAdapter();
    const handle = await adapter.createSession({
      agent: "claude",
      cwd: "/workspace/cleanup",
    });

    // When the session is destroyed
    // Then no error is thrown
    await expect(adapter.destroySession(handle.id)).resolves.toBeUndefined();
  });

  // ─── UA-4: resumeSession returns a SessionHandle for existing session ───
  // US-05
  it("resumeSession returns a handle for a previously created session", async () => {
    // Given a session that was previously created
    const adapter = createMockAdapter();
    const original = await adapter.createSession({
      agent: "claude",
      cwd: "/workspace/restore-test",
    });

    // When the session is resumed by ID
    const resumed = await adapter.resumeSession(original.id);

    // Then a valid session handle is returned
    expect(resumed.id).toBe(original.id);
    expect(typeof resumed.prompt).toBe("function");
  });

  // ─── UA-5: createSession propagates connection errors ───
  // US-01 (error path)
  it("createSession propagates adapter connection errors", async () => {
    // Given an adapter that fails to connect to the SandboxAgent server
    const adapter = createMockAdapter({
      createSession: async () => {
        throw new Error("SandboxAgent server unavailable at localhost:4100");
      },
    });

    // When a session creation is attempted
    // Then the error propagates with a meaningful message
    await expect(
      adapter.createSession({ agent: "claude", cwd: "/workspace/fail" }),
    ).rejects.toThrow("SandboxAgent server unavailable");
  });

  // ─── UA-6: prompt on destroyed session throws ───
  // US-04 (error path)
  it("prompt on a destroyed session throws an error", async () => {
    // Given a session that has been destroyed
    const adapter = createMockAdapter();
    const handle = await adapter.createSession({
      agent: "claude",
      cwd: "/workspace/destroyed",
    });
    await adapter.destroySession(handle.id);

    // When a prompt is sent to the destroyed session
    // Then an error is thrown indicating the session is gone
    await expect(
      handle.prompt([{ type: "text", text: "This should fail" }]),
    ).rejects.toThrow();
  });
});
