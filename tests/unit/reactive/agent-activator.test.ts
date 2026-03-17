/**
 * Unit tests for Agent Activator pure functions.
 *
 * Tests the pure core: parseWebhookPayload, buildDampenerEvent, buildClassificationPrompt.
 *
 * Step: 03-02 (Graph-Reactive Coordination)
 */
import { describe, expect, it } from "bun:test";
import {
  parseWebhookPayload,
  buildDampenerEvent,
  buildClassificationPrompt,
} from "../../../app/src/server/reactive/agent-activator";

describe("Agent Activator Pure Functions", () => {
  // ---------------------------------------------------------------------------
  // parseWebhookPayload
  // ---------------------------------------------------------------------------
  describe("parseWebhookPayload", () => {
    it("parses valid webhook payload", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "ws-456",
        text: "conflict detected",
        severity: "conflict",
        source_agent: "observer_agent",
      };

      const result = parseWebhookPayload(body);

      expect(result).toBeDefined();
      expect(result!.observation_id).toBe("obs-123");
      expect(result!.workspace).toBe("ws-456");
      expect(result!.text).toBe("conflict detected");
      expect(result!.severity).toBe("conflict");
      expect(result!.source_agent).toBe("observer_agent");
    });

    it("extracts workspace ID from prefixed string", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "workspace:ws-456",
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
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      const result = parseWebhookPayload(body);
      expect(result!.observation_id).toBe("obs-123");
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
        text: "test",
        severity: "info",
        source_agent: "test",
      };

      expect(parseWebhookPayload(body)).toBeUndefined();
    });

    it("returns undefined for missing text", () => {
      const body = {
        observation_id: "obs-123",
        workspace: "ws-456",
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

  // ---------------------------------------------------------------------------
  // buildClassificationPrompt
  // ---------------------------------------------------------------------------
  describe("buildClassificationPrompt", () => {
    it("includes observation text and severity", () => {
      const prompt = buildClassificationPrompt(
        { text: "API latency exceeding SLA", severity: "conflict" },
        [],
      );

      expect(prompt).toContain("API latency exceeding SLA");
      expect(prompt).toContain("conflict");
    });

    it("lists all agent descriptions", () => {
      const prompt = buildClassificationPrompt(
        { text: "test", severity: "info" },
        [
          { agentId: "a1", agentType: "code_agent", description: "Infra engineering" },
          { agentId: "a2", agentType: "code_agent", description: "Customer support" },
        ],
      );

      expect(prompt).toContain("Infra engineering");
      expect(prompt).toContain("Customer support");
      expect(prompt).toContain("a1");
      expect(prompt).toContain("a2");
    });

    it("handles empty agent list", () => {
      const prompt = buildClassificationPrompt(
        { text: "test", severity: "info" },
        [],
      );

      expect(prompt).toContain("test");
    });
  });
});
