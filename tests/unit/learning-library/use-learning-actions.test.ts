/**
 * Unit tests for use-learning-actions hook.
 *
 * Tests the pure URL/request-building functions.
 */
import { describe, expect, it } from "bun:test";
import {
  buildActionUrl,
  buildEditUrl,
  buildCreateUrl,
  buildActionRequest,
  buildEditRequest,
  buildCreateRequest,
} from "../../../app/src/client/hooks/use-learning-actions";

const workspaceId = "ws-abc";
const learningId = "lr-123";

describe("buildActionUrl", () => {
  it("builds the action endpoint URL", () => {
    expect(buildActionUrl(workspaceId, learningId)).toBe(
      "/api/workspaces/ws-abc/learnings/lr-123/actions",
    );
  });
});

describe("buildEditUrl", () => {
  it("builds the edit endpoint URL", () => {
    expect(buildEditUrl(workspaceId, learningId)).toBe(
      "/api/workspaces/ws-abc/learnings/lr-123",
    );
  });
});

describe("buildCreateUrl", () => {
  it("builds the create endpoint URL", () => {
    expect(buildCreateUrl(workspaceId)).toBe(
      "/api/workspaces/ws-abc/learnings",
    );
  });
});

describe("buildActionRequest", () => {
  it("builds a POST request with action body", () => {
    const req = buildActionRequest("approve");
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({ action: "approve" });
  });

  it("supports all action types", () => {
    for (const action of ["approve", "dismiss", "deactivate"] as const) {
      const req = buildActionRequest(action);
      expect(JSON.parse(req.body).action).toBe(action);
    }
  });
});

describe("buildEditRequest", () => {
  it("builds a PUT request with update fields", () => {
    const req = buildEditRequest({ text: "Updated text", priority: "high" });
    expect(req.method).toBe("PUT");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({ text: "Updated text", priority: "high" });
  });
});

describe("buildCreateRequest", () => {
  it("builds a POST request with learning data", () => {
    const data = {
      text: "New learning",
      learning_type: "constraint" as const,
      priority: "high" as const,
      target_agents: ["chat_agent"],
    };
    const req = buildCreateRequest(data);
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual(data);
  });
});
