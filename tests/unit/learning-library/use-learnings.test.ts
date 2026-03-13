/**
 * Unit tests for use-learnings hook.
 *
 * Tests the pure URL-building logic and exported type shape.
 * React state/effect behavior is integration-level (tested via acceptance tests).
 */
import { describe, expect, it } from "bun:test";
import { buildLearningsUrl } from "../../../app/src/client/hooks/use-learnings";
import type { LearningFilters } from "../../../app/src/client/hooks/use-learnings";

describe("buildLearningsUrl", () => {
  const workspaceId = "ws-123";

  it("builds base URL with no filters", () => {
    const url = buildLearningsUrl(workspaceId, {});
    expect(url).toBe("/api/workspaces/ws-123/learnings");
  });

  it("appends status filter as query parameter", () => {
    const url = buildLearningsUrl(workspaceId, { status: "active" });
    expect(url).toBe("/api/workspaces/ws-123/learnings?status=active");
  });

  it("appends type filter as query parameter", () => {
    const url = buildLearningsUrl(workspaceId, { type: "constraint" });
    expect(url).toBe("/api/workspaces/ws-123/learnings?type=constraint");
  });

  it("appends agent filter as query parameter", () => {
    const url = buildLearningsUrl(workspaceId, { agent: "pm_agent" });
    expect(url).toBe("/api/workspaces/ws-123/learnings?agent=pm_agent");
  });

  it("combines multiple filters", () => {
    const filters: LearningFilters = {
      status: "active",
      type: "instruction",
      agent: "chat_agent",
    };
    const url = buildLearningsUrl(workspaceId, filters);
    expect(url).toContain("status=active");
    expect(url).toContain("type=instruction");
    expect(url).toContain("agent=chat_agent");
    expect(url).toStartWith("/api/workspaces/ws-123/learnings?");
  });

  it("omits undefined filter values", () => {
    const filters: LearningFilters = {
      status: "active",
      type: undefined,
      agent: undefined,
    };
    const url = buildLearningsUrl(workspaceId, filters);
    expect(url).toBe("/api/workspaces/ws-123/learnings?status=active");
  });

  it("encodes workspace ID for URL safety", () => {
    const url = buildLearningsUrl("ws with spaces", {});
    expect(url).toBe("/api/workspaces/ws%20with%20spaces/learnings");
  });
});
