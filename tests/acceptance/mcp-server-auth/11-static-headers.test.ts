/**
 * Acceptance Tests: Static Header Authentication (US-1)
 *
 * Walking skeleton: Admin configures static headers on an MCP server.
 * Headers are encrypted at rest, never returned in API responses,
 * and injected on every MCP client connection.
 *
 * Traces: US-1, FR-1, AC-1a..AC-1g
 * Driving port: POST /api/workspaces/:wsId/mcp-servers
 *
 * Implementation sequence:
 *   1. Walking skeleton: create MCP server with static headers     [ENABLED]
 *   2. Header values encrypted at rest                             [ENABLED]
 *   3. Header values never in API response                         [ENABLED]
 *   4. Static headers injected on MCP connect                      [ENABLED]
 *   5. Update static headers                                       [@skip]
 *   6. Remove all static headers                                   [@skip]
 *   7. Reject restricted header names                              [@skip]
 *   8. Multiple headers on same server                             [@skip]
 */
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import {
  setupMcpServerAuthSuite,
  createTestUserWithMcp,
  seedMcpServer,
  getMcpServer,
  setupMockMcpServer,
  type CapturedRequest,
} from "./mcp-server-auth-test-kit";
import { http, HttpResponse } from "msw";
import { setupServer as setupMswServer } from "msw/node";

const getRuntime = setupMcpServerAuthSuite("mcp_server_auth_static_headers");

// ---------------------------------------------------------------------------
// Walking Skeleton: Create MCP server with static headers
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Admin adds MCP server with static headers", () => {
  it("creates an mcp_server with auth_mode static_headers via API", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-sh-${crypto.randomUUID()}`);

    // Given a workspace admin
    // When creating an MCP server with auth_mode "static_headers"
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers`,
      {
        method: "POST",
        body: {
          name: "github-mcp",
          url: "https://mcp.github.com",
          transport: "streamable-http",
          auth_mode: "static_headers",
          static_headers: [
            { name: "Authorization", value: "Bearer ghp_test123" },
          ],
        },
      },
    );

    // Then the server is created successfully
    expect(response.status).toBe(201);
    const body = await response.json() as { id: string };
    expect(body.id).toBeDefined();
  }, 30_000);
});

describe("Header values encrypted at rest", () => {
  it("stores header values encrypted, not as plaintext", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-enc-${crypto.randomUUID()}`);

    // Given an MCP server with static headers created via API
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers`,
      {
        method: "POST",
        body: {
          name: "enc-test",
          url: "https://mcp.example.com",
          transport: "streamable-http",
          auth_mode: "static_headers",
          static_headers: [
            { name: "Authorization", value: "Bearer secret_token_value" },
          ],
        },
      },
    );

    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };

    // When reading the record directly from SurrealDB
    const record = await getMcpServer(surreal, id);

    // Then the header value is encrypted (not stored as plaintext)
    expect(record).toBeDefined();
    const headers = record!.static_headers as Array<{ name: string; value_encrypted: string }>;
    expect(headers).toHaveLength(1);
    expect(headers[0].name).toBe("Authorization");
    expect(headers[0].value_encrypted).toBeDefined();
    expect(headers[0].value_encrypted).not.toBe("Bearer secret_token_value");
    // Encrypted values should not contain the raw secret
    expect(headers[0].value_encrypted).not.toContain("secret_token_value");
  }, 30_000);
});

describe("Header values never in API response", () => {
  it("GET response includes header names but not values", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-noexp-${crypto.randomUUID()}`);

    // Given an MCP server with static headers
    await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers`,
      {
        method: "POST",
        body: {
          name: "noexpose-test",
          url: "https://mcp.example.com",
          transport: "streamable-http",
          auth_mode: "static_headers",
          static_headers: [
            { name: "X-API-Key", value: "sk-supersecret" },
          ],
        },
      },
    );

    // When listing MCP servers via API
    const listResponse = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers`,
      { method: "GET" },
    );

    // Then the response body does not contain the secret value
    const body = await listResponse.text();
    expect(body).not.toContain("sk-supersecret");
    expect(body).not.toContain("supersecret");

    // And has_static_headers is true
    const parsed = JSON.parse(body) as { servers?: Array<Record<string, unknown>> };
    const servers = parsed.servers ?? [];
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0].has_static_headers).toBe(true);
  }, 30_000);
});

describe("Static headers injected on MCP connect", () => {
  it("MCP client sends configured headers when connecting to server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-inject-${crypto.randomUUID()}`);

    const mockUrl = "https://mcp-static-auth.example.com";
    const expectedAuth = "Bearer ghp_test_inject_123";
    const capturedRequests: CapturedRequest[] = [];

    // Set up MSW mock that handles the full MCP JSON-RPC protocol
    // and requires the Authorization header on every request
    const msw = setupMswServer(
      http.post(mockUrl, async ({ request }) => {
        capturedRequests.push({
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
        });

        // Reject requests without the correct Authorization header
        const authHeader = request.headers.get("authorization");
        if (authHeader !== expectedAuth) {
          return new HttpResponse(null, { status: 401 });
        }

        // Parse JSON-RPC request to dispatch by method
        const body = await request.json() as { jsonrpc: string; id?: number; method: string };

        if (body.method === "initialize") {
          return HttpResponse.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "mock-mcp-server", version: "1.0.0" },
            },
          });
        }

        if (body.method === "notifications/initialized") {
          // Notification -- no response needed but return 200
          return new HttpResponse(null, { status: 200 });
        }

        if (body.method === "tools/list") {
          return HttpResponse.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "mock_tool",
                  description: "A mock tool for testing",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            },
          });
        }

        // Unknown method
        return HttpResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        });
      }),
    );
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Given an MCP server with static header "Authorization: Bearer ghp_test_inject_123"
      const createResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        {
          method: "POST",
          body: {
            name: `inject-test-${crypto.randomUUID().slice(0, 8)}`,
            url: mockUrl,
            transport: "streamable-http",
            auth_mode: "static_headers",
            static_headers: [
              { name: "Authorization", value: expectedAuth },
            ],
          },
        },
      );

      expect(createResponse.status).toBe(201);
      const { id: serverId } = await createResponse.json() as { id: string };

      // When Brain connects to the MCP server for discovery
      const discoverResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover`,
        { method: "POST" },
      );

      // Then the discovery succeeds (server received correct auth header)
      expect(discoverResponse.status).toBe(200);
      const discoverBody = await discoverResponse.json() as { tools: Array<{ name: string }> };

      // And tools/list returns tools from the authenticated server
      expect(discoverBody.tools).toBeDefined();
      expect(discoverBody.tools.length).toBeGreaterThan(0);
      expect(discoverBody.tools[0].name).toBe("mock_tool");

      // And the HTTP request included the correct Authorization header
      expect(capturedRequests.length).toBeGreaterThan(0);
      const mcpRequest = capturedRequests.find((r) => r.headers.authorization === expectedAuth);
      expect(mcpRequest).toBeDefined();
    } finally {
      msw.close();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Milestone 1: Static Header Management
// ---------------------------------------------------------------------------
describe("Update static headers", () => {
  it("replaces existing headers with new values", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-upd-${crypto.randomUUID()}`);

    // Given an MCP server with header "Authorization: Bearer old_token"
    const createResponse = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers`,
      {
        method: "POST",
        body: {
          name: `update-test-${crypto.randomUUID().slice(0, 8)}`,
          url: "https://mcp.example.com",
          transport: "streamable-http",
          auth_mode: "static_headers",
          static_headers: [
            { name: "Authorization", value: "Bearer old_token" },
          ],
        },
      },
    );
    expect(createResponse.status).toBe(201);
    const { id: serverId } = await createResponse.json() as { id: string };

    // When admin PUTs new headers via /mcp-servers/:id/headers
    const updateResponse = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/headers`,
      {
        method: "PUT",
        body: {
          headers: [
            { name: "Authorization", value: "Bearer new_token_value" },
          ],
        },
      },
    );

    // Then the update succeeds
    expect(updateResponse.status).toBe(200);
    const updateBody = await updateResponse.json() as { id: string; has_static_headers: boolean };
    expect(updateBody.has_static_headers).toBe(true);

    // And the DB stores only the new encrypted value (old value removed)
    const record = await getMcpServer(surreal, serverId);
    expect(record).toBeDefined();
    const headers = record!.static_headers as Array<{ name: string; value_encrypted: string }>;
    expect(headers).toHaveLength(1);
    expect(headers[0].name).toBe("Authorization");
    // The encrypted value should not contain the old plaintext token
    expect(headers[0].value_encrypted).not.toContain("old_token");
    // The encrypted value should not contain the new plaintext token either (it's encrypted)
    expect(headers[0].value_encrypted).not.toContain("new_token_value");
  }, 30_000);
});

describe("Remove all static headers", () => {
  it.skip("switching auth_mode to none clears stored headers", async () => {
    // Given MCP server with static headers
    // When admin updates auth_mode to "none"
    // Then static_headers field is cleared from DB
  }, 30_000);
});

describe("Reject restricted header names", () => {
  it.skip("rejects Host, Content-Length, Transfer-Encoding, Connection", async () => {
    // Given admin tries to create MCP server with header name "Host"
    // When POST /mcp-servers with static_headers: [{name: "Host", value: "evil.com"}]
    // Then response is 400 with validation error
  }, 30_000);
});

describe("Multiple headers on same server", () => {
  it.skip("stores and injects multiple key-value pairs", async () => {
    // Given admin creates server with Authorization + X-Custom-Header
    // When Brain connects to MCP server
    // Then both headers are present in the HTTP request
  }, 30_000);
});
