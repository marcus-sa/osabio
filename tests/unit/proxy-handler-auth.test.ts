import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import type { ServerDependencies } from "../../app/src/server/runtime/types";
import { createAnthropicProxyHandler } from "../../app/src/server/proxy/anthropic-proxy-route";

function createTestDeps(): ServerDependencies {
  const surreal = {
    query: async (sql: string) => {
      if (sql.includes("FROM proxy_token WHERE token_hash")) {
        return [[{
          workspace: new RecordId("workspace", "ws-1"),
          identity: new RecordId("identity", "identity-1"),
          expires_at: new Date(Date.now() + 60_000),
          revoked: false,
        }]];
      }

      if (sql.includes("SELECT id FROM $ws;")) {
        return [[{ id: new RecordId("workspace", "ws-1") }]];
      }

      return [[]];
    },
  };

  const deps = {
    config: {
      anthropicApiUrl: "https://api.anthropic.com",
      embeddingDimension: 1536,
    },
    surreal,
    inflight: { track: () => {}, drain: async () => {} },
  };

  return deps as unknown as ServerDependencies;
}

describe("createAnthropicProxyHandler auth behavior", () => {
  it("forwards client x-api-key upstream in osabio auth mode when server key is unset", async () => {
    const handler = createAnthropicProxyHandler(createTestDeps());
    const originalFetch = globalThis.fetch;
    let forwardedHeaders: Headers | undefined;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ input_tokens: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-osabio-auth": "osabio-proxy-token",
          "x-api-key": "sk-ant-client-key",
        },
        body: JSON.stringify({ model: "claude-opus-4-6", messages: [] }),
      });

      const response = await handler(request);
      expect(response.status).toBe(200);
      expect(forwardedHeaders?.get("x-api-key")).toBe("sk-ant-client-key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 500 when Brain auth succeeds but server has no API key configured", async () => {
    const handler = createAnthropicProxyHandler(createTestDeps());
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;

    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    try {
      const request = new Request("http://localhost/proxy/llm/anthropic/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-osabio-auth": "osabio-proxy-token",
        },
        body: JSON.stringify({ model: "claude-opus-4-6", messages: [] }),
      });

      const response = await handler(request);
      const payload = await response.json() as { error: { type: string }; stage?: string };

      expect(response.status).toBe(500);
      expect(fetchCalled).toBe(false);
      expect(payload.error.type).toBe("server_error");
      expect(payload.stage).toBe("validate_api_key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
