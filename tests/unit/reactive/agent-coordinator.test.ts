/**
 * Unit tests for Agent Coordinator pure functions.
 *
 * Tests the pure core: filterAboveThreshold, parseWebhookPayload, buildDampenerEvent.
 *
 * Step: 03-02 (Graph-Reactive Coordination)
 */
import { describe, expect, it } from "bun:test";
import {
  filterAboveThreshold,
  parseWebhookPayload,
  buildDampenerEvent,
} from "../../../app/src/server/reactive/agent-coordinator";

describe("Agent Coordinator Pure Functions", () => {
  // ---------------------------------------------------------------------------
  // filterAboveThreshold
  // ---------------------------------------------------------------------------
  describe("filterAboveThreshold", () => {
    it("keeps candidates at or above threshold", () => {
      const candidates = [
        { agentId: "a1", similarity: 0.9 },
        { agentId: "a2", similarity: 0.7 },
        { agentId: "a3", similarity: 0.5 },
        { agentId: "a4", similarity: 0.65 },
      ];

      const result = filterAboveThreshold(candidates, 0.65);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.agentId)).toEqual(["a1", "a2", "a4"]);
    });

    it("returns empty array when all below threshold", () => {
      const candidates = [
        { agentId: "a1", similarity: 0.3 },
        { agentId: "a2", similarity: 0.1 },
      ];

      const result = filterAboveThreshold(candidates, 0.65);

      expect(result).toHaveLength(0);
    });

    it("returns all candidates when all above threshold", () => {
      const candidates = [
        { agentId: "a1", similarity: 0.9 },
        { agentId: "a2", similarity: 0.8 },
      ];

      const result = filterAboveThreshold(candidates, 0.65);

      expect(result).toHaveLength(2);
    });

    it("handles empty input", () => {
      const result = filterAboveThreshold([], 0.65);
      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // parseWebhookPayload
  // ---------------------------------------------------------------------------
  describe("parseWebhookPayload", () => {
    it("parses valid webhook payload", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "ws-456",
        embedding: [0.1, 0.2, 0.3],
        text: "conflict detected",
        severity: "conflict",
        source_agent: "observer_agent",
      };

      const result = parseWebhookPayload(body);

      expect(result).toBeDefined();
      expect(result!.observation_id).toBe("obs-123");
      expect(result!.workspace).toBe("ws-456");
      expect(result!.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result!.text).toBe("conflict detected");
      expect(result!.severity).toBe("conflict");
      expect(result!.source_agent).toBe("observer_agent");
    });

    it("extracts workspace ID from prefixed string", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "workspace:ws-456",
        embedding: [0.1],
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      const result = parseWebhookPayload(body);
      expect(result!.workspace).toBe("ws-456");
    });

    it("strips observation: prefix from observation_id", () => {
      const body = {
        observation_id: "observation:obs-123",
        workspace: "ws-456",
        embedding: [0.1],
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      const result = parseWebhookPayload(body);
      expect(result!.observation_id).toBe("obs-123");
    });

    it("returns undefined for missing embedding", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "ws-456",
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      expect(parseWebhookPayload(body)).toBeUndefined();
    });

    it("returns undefined for empty embedding", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "ws-456",
        embedding: [],
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      expect(parseWebhookPayload(body)).toBeUndefined();
    });

    it("returns undefined for null body", () => {
      expect(parseWebhookPayload(null)).toBeUndefined();
    });

    it("returns undefined for non-object body", () => {
      expect(parseWebhookPayload("string")).toBeUndefined();
    });

    it("returns undefined for missing workspace", () => {
      const body = {
        observation_id: "obs-123",
        embedding: [0.1],
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      expect(parseWebhookPayload(body)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // buildDampenerEvent
  // ---------------------------------------------------------------------------
  describe("buildDampenerEvent", () => {
    it("constructs dampener event with correct fields", () => {
      const result = buildDampenerEvent("ws-1", "obs-1", "observer_agent");

      expect(result).toEqual({
        workspaceId: "ws-1",
        entityId: "obs-1",
        sourceAgent: "observer_agent",
      });
    });
  });
});
