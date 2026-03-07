import { describe, expect, it } from "bun:test";
import {
  buildEntityDetailResponse,
  type AgentSessionRow,
} from "../../app/src/server/entities/entity-detail-response";

const baseDetail = {
  entity: {
    id: "task:abc123",
    kind: "task" as const,
    name: "Implement auth",
    data: { status: "in_progress" },
  },
  relationships: [],
  provenance: [],
};

const activeSessionRow: AgentSessionRow = {
  id: "session-001",
  orchestrator_status: "active",
  stream_id: "stream-xyz",
  started_at: "2026-03-07T10:00:00Z",
  files_changed_count: 3,
};

describe("buildEntityDetailResponse", () => {
  it("includes agentSession when task has active session", () => {
    const response = buildEntityDetailResponse(baseDetail, activeSessionRow);

    expect(response.agentSession).toEqual({
      agentSessionId: "session-001",
      orchestratorStatus: "active",
      streamId: "stream-xyz",
      startedAt: "2026-03-07T10:00:00Z",
      filesChangedCount: 3,
    });
  });

  it("omits agentSession when no session row provided", () => {
    const response = buildEntityDetailResponse(baseDetail, undefined);

    expect(response.agentSession).toBeUndefined();
    expect("agentSession" in response).toBe(false);
  });

  it("omits agentSession for non-task entities regardless of session", () => {
    const projectDetail = {
      ...baseDetail,
      entity: { ...baseDetail.entity, kind: "project" as const },
    };

    const response = buildEntityDetailResponse(projectDetail, activeSessionRow);

    expect(response.agentSession).toBeUndefined();
    expect("agentSession" in response).toBe(false);
  });

  it("includes agentSession for spawning status", () => {
    const spawningSession: AgentSessionRow = {
      ...activeSessionRow,
      orchestrator_status: "spawning",
      files_changed_count: 0,
    };

    const response = buildEntityDetailResponse(baseDetail, spawningSession);

    expect(response.agentSession?.orchestratorStatus).toBe("spawning");
    expect(response.agentSession?.filesChangedCount).toBe(0);
  });

  it("includes agentSession for idle status", () => {
    const idleSession: AgentSessionRow = {
      ...activeSessionRow,
      orchestrator_status: "idle",
    };

    const response = buildEntityDetailResponse(baseDetail, idleSession);

    expect(response.agentSession?.orchestratorStatus).toBe("idle");
  });

  it("preserves entity, relationships, and provenance in response", () => {
    const response = buildEntityDetailResponse(baseDetail, activeSessionRow);

    expect(response.entity).toEqual(baseDetail.entity);
    expect(response.relationships).toEqual(baseDetail.relationships);
    expect(response.provenance).toEqual(baseDetail.provenance);
  });
});
