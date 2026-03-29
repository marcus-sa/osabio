/**
 * Unit Tests: Dual-Mode Proxy Handler
 *
 * Tests the branching logic for Brain auth vs direct auth proxy modes.
 * Pure function tests — no IO, no DB.
 *
 * Behaviors:
 *   1. buildUpstreamHeaders in direct mode: forwards client x-api-key/authorization
 *   2. buildUpstreamHeaders in osabio auth mode: injects server API key, omits client auth
 *   3. resolveBrainAuth returns ProxyAuthResult when X-Osabio-Auth is valid
 *   4. resolveBrainAuth returns undefined when X-Osabio-Auth is absent (pass-through)
 *   5. Brain auth mode without server API key forwards client auth headers
 */
import { describe, expect, it } from "bun:test";
import {
  buildUpstreamHeaders,
  buildProxyErrorPayload,
  type AuthMode,
} from "../../app/src/server/proxy/anthropic-proxy-route";

describe("buildUpstreamHeaders", () => {
  // --- Direct auth mode ---
  describe("direct auth mode", () => {
    const directAuth: AuthMode = { mode: "direct" };

    it("forwards client x-api-key header", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-ant-client-key-123",
        },
      });

      const headers = buildUpstreamHeaders(request, directAuth);

      expect(headers.get("x-api-key")).toBe("sk-ant-client-key-123");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("content-type")).toBe("application/json");
    });

    it("forwards client authorization header", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": "Bearer sk-ant-client-bearer",
        },
      });

      const headers = buildUpstreamHeaders(request, directAuth);

      expect(headers.get("authorization")).toBe("Bearer sk-ant-client-bearer");
    });

    it("forwards anthropic-beta header when present", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-beta": "messages-2024-12-19",
          "x-api-key": "sk-test",
        },
      });

      const headers = buildUpstreamHeaders(request, directAuth);

      expect(headers.get("anthropic-beta")).toBe("messages-2024-12-19");
    });
  });

  // --- Brain auth mode ---
  describe("osabio auth mode", () => {
    const osabioAuth: AuthMode = {
      mode: "osabio",
      serverApiKey: "sk-ant-server-key-456",
    };

    it("injects server API key as x-api-key", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
      });

      const headers = buildUpstreamHeaders(request, osabioAuth);

      expect(headers.get("x-api-key")).toBe("sk-ant-server-key-456");
    });

    it("does not forward client x-api-key or authorization headers", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-ant-client-should-not-appear",
          "authorization": "Bearer should-not-appear",
        },
      });

      const headers = buildUpstreamHeaders(request, osabioAuth);

      expect(headers.get("x-api-key")).toBe("sk-ant-server-key-456");
      // authorization should NOT be forwarded in osabio auth mode
      expect(headers.get("authorization")).toBeNull();
    });

    it("still forwards standard anthropic headers", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "messages-2024-12-19",
        },
      });

      const headers = buildUpstreamHeaders(request, osabioAuth);

      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("anthropic-beta")).toBe("messages-2024-12-19");
      expect(headers.get("content-type")).toBe("application/json");
    });
  });

  // --- Brain auth mode without server API key (client provides own key) ---
  describe("osabio auth mode without server API key", () => {
    const osabioAuthNoKey: AuthMode = { mode: "osabio" };

    it("forwards client x-api-key when no server key configured", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-ant-client-key-789",
        },
      });

      const headers = buildUpstreamHeaders(request, osabioAuthNoKey);

      expect(headers.get("x-api-key")).toBe("sk-ant-client-key-789");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
    });

    it("forwards client authorization header when no server key configured", () => {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": "Bearer sk-ant-client-bearer-passthrough",
        },
      });

      const headers = buildUpstreamHeaders(request, osabioAuthNoKey);

      expect(headers.get("authorization")).toBe("Bearer sk-ant-client-bearer-passthrough");
    });
  });
});

describe("buildProxyErrorPayload", () => {
  it("returns required error fields only when no options are provided", () => {
    const payload = buildProxyErrorPayload(
      "authentication_error",
      "Missing x-api-key or authorization header",
    );

    expect(payload).toEqual({
      error: {
        type: "authentication_error",
        message: "Missing x-api-key or authorization header",
      },
    });
  });

  it("includes stage, trace_id, and upstream_status when provided", () => {
    const payload = buildProxyErrorPayload(
      "upstream_error",
      "Anthropic returned 500",
      {
        stage: "read_non_streaming_response",
        traceId: "trace-123",
        upstreamStatus: 500,
      },
    );

    expect(payload).toEqual({
      error: {
        type: "upstream_error",
        message: "Anthropic returned 500",
      },
      stage: "read_non_streaming_response",
      trace_id: "trace-123",
      upstream_status: 500,
    });
  });
});
