/**
 * Unit tests for sandbox session store query construction.
 *
 * Tests query shapes and parameter binding for SurrealDB session operations.
 * No real SurrealDB -- validates query construction logic only.
 *
 * Traces: US-02 (persistence), US-05 (restoration)
 *
 * Driving port: Session store functions (pure query builders)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  createSandboxSession,
  updateSessionStatus,
  getActiveSandboxSessions,
  updateExternalSessionId,
} from "../../../app/src/server/orchestrator/session-store";

// ── Stub SurrealDB client ──

type QueryCall = { sql: string; vars: Record<string, unknown> };

function createMockSurreal(): {
  queries: QueryCall[];
  query: (sql: string, vars?: Record<string, unknown>) => Promise<unknown[]>;
} {
  const queries: QueryCall[] = [];
  return {
    queries,
    query: async (sql: string, vars?: Record<string, unknown>) => {
      queries.push({ sql, vars: vars ?? {} });
      return [[]];
    },
  };
}

// ── Tests ──

describe("Session Store Queries", () => {
  // ─── UC-1: Create session record with sandbox fields ───
  // US-02
  it("creates a session record with session_type sandbox_agent and provider", async () => {
    // Given session creation parameters for a sandbox agent
    const surreal = createMockSurreal();

    // When the session is created in the store
    const result = await createSandboxSession({
      surreal: surreal as any,
      workspaceId: "acme-engineering",
      agent: "claude",
      provider: "local",
    });

    // Then the SurrealDB query includes session_type and provider fields
    expect(surreal.queries.length).toBeGreaterThan(0);
    const createQuery = surreal.queries[0];
    expect(createQuery.sql).toContain("session_type");
    expect(createQuery.sql).toContain("provider");

    // And session_type is "sandbox_agent"
    expect(createQuery.vars).toHaveProperty("session_type", "sandbox_agent");

    // And provider is "local"
    expect(createQuery.vars).toHaveProperty("provider", "local");

    // And orchestrator_status is "running"
    expect(createQuery.vars).toHaveProperty("orchestrator_status", "running");

    // And the result contains sessionId and streamId
    expect(result.sessionId).toBeDefined();
    expect(result.streamId).toBeDefined();
    expect(result.streamId).toContain(result.sessionId);
  });

  // ─── UC-2: Update session status transitions ───
  // US-02
  it("updates session status from running to completed", async () => {
    // Given an active session with status "running"
    const surreal = createMockSurreal();
    const sessionId = "session-abc-123";

    // When the status is updated to "completed"
    await updateSessionStatus(surreal as any, sessionId, "completed");

    // Then the SurrealDB query updates orchestrator_status
    expect(surreal.queries.length).toBeGreaterThan(0);
    const updateQuery = surreal.queries[0];
    expect(updateQuery.sql).toContain("orchestrator_status");
    expect(updateQuery.vars).toHaveProperty("status", "completed");

    // And the query targets the correct session record
    const recordVar = updateQuery.vars.record;
    expect(recordVar).toBeInstanceOf(RecordId);
    expect((recordVar as RecordId).table.name).toBe("agent_session");
    expect((recordVar as RecordId).id).toBe(sessionId);
  });

  // ─── UC-3: Query active sandbox sessions by workspace ───
  // US-02
  it("queries active sandbox sessions filtered by workspace and session_type", async () => {
    // Given a workspace with active sandbox sessions
    const surreal = createMockSurreal();
    const workspaceId = "acme-engineering";

    // When active sessions are queried
    await getActiveSandboxSessions(surreal as any, workspaceId);

    // Then the query filters by session_type
    expect(surreal.queries.length).toBeGreaterThan(0);
    const selectQuery = surreal.queries[0];
    expect(selectQuery.sql).toContain("session_type");
    expect(selectQuery.vars).toHaveProperty("session_type", "sandbox_agent");

    // And filters by orchestrator_status IN active statuses
    expect(selectQuery.sql).toContain("orchestrator_status");
    expect(selectQuery.sql).toContain("IN");
    expect(selectQuery.vars).toHaveProperty("active_statuses");
    const activeStatuses = selectQuery.vars.active_statuses as string[];
    expect(activeStatuses).toContain("running");
    expect(activeStatuses).toContain("idle");
    expect(activeStatuses).toContain("restoring");

    // And filters by workspace
    const wsVar = selectQuery.vars.workspace;
    expect(wsVar).toBeInstanceOf(RecordId);
    expect((wsVar as RecordId).table.name).toBe("workspace");
    expect((wsVar as RecordId).id).toBe(workspaceId);
  });

  // ─── UC-4: Update external_session_id on restoration ───
  // US-05
  it("updates external_session_id when session is restored to new runtime", async () => {
    // Given a session being restored after a disconnect
    const surreal = createMockSurreal();
    const sessionId = "session-rate-limiter-a1b2";
    const newExternalId = "runtime-xyz-789";

    // When the external session ID is updated
    await updateExternalSessionId(surreal as any, sessionId, newExternalId);

    // Then the SurrealDB query updates external_session_id
    expect(surreal.queries.length).toBeGreaterThan(0);
    const updateQuery = surreal.queries[0];
    expect(updateQuery.sql).toContain("external_session_id");
    expect(updateQuery.vars).toHaveProperty("external_session_id", newExternalId);

    // And the query targets the correct session record
    const recordVar = updateQuery.vars.record;
    expect(recordVar).toBeInstanceOf(RecordId);
    expect((recordVar as RecordId).id).toBe(sessionId);
  });

  // ─── UC-5: Session type discrimination ───
  // US-02
  it("sandbox_agent sessions are distinguishable from claude_agent_sdk sessions", async () => {
    // Given both sandbox_agent and claude_agent_sdk sessions exist
    const surreal = createMockSurreal();

    // When querying for sandbox sessions only
    await getActiveSandboxSessions(surreal as any, "acme-engineering");

    // Then only sessions with session_type = "sandbox_agent" are returned
    const selectQuery = surreal.queries[0];
    // The query must explicitly filter on session_type via parameterized value
    expect(selectQuery.sql).toContain("session_type");
    expect(selectQuery.vars).toHaveProperty("session_type", "sandbox_agent");

    // And claude_agent_sdk sessions are excluded by the filter
    // (the WHERE clause parameter only matches sandbox_agent, not claude_agent_sdk)
    expect(selectQuery.vars.session_type).not.toBe("claude_agent_sdk");
  });
});
