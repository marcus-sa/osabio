/**
 * Acceptance Tests: MCP OAuth 2.1 Discovery (US-2)
 *
 * Milestone 2: Brain auto-discovers OAuth requirements from MCP server URL
 * using Protected Resource Metadata (RFC 9728) and Auth Server Metadata (RFC 8414).
 * MSW simulates the external MCP server and OAuth authorization server.
 *
 * Traces: US-2, FR-2, AC-2a..AC-2f
 * Driving port: POST /api/workspaces/:wsId/mcp-servers/:id/discover-auth
 *
 * Implementation sequence:
 *   1. Discover auth from Protected Resource Metadata              [@skip]
 *   2. Discover auth from WWW-Authenticate header on 401           [@skip]
 *   3. Auth server metadata with path component (multi-fallback)   [@skip]
 *   4. Discovery fails gracefully (no metadata)                    [@skip]
 *   5. Auto-created credential_provider from discovery             [@skip]
 */
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  setupMockMcpServer,
} from "./mcp-server-auth-test-kit";

const getRuntime = setupAcceptanceSuite("mcp_server_auth_oauth_discovery");

// ---------------------------------------------------------------------------
// Milestone 2: OAuth 2.1 Discovery
// ---------------------------------------------------------------------------
describe("Discover auth from Protected Resource Metadata", () => {
  it.skip("fetches .well-known/oauth-protected-resource and auth server metadata", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-disc-${crypto.randomUUID()}`);

    // Given MSW mock MCP server with Protected Resource Metadata
    const { msw } = setupMockMcpServer({
      mcpServerUrl: "https://mcp.example.com",
      authServerUrl: "https://auth.example.com",
      scopesSupported: ["tools:read", "tools:execute"],
    });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // And an MCP server record exists
      const createResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        {
          method: "POST",
          body: {
            name: "oauth-test",
            url: "https://mcp.example.com",
            transport: "streamable-http",
            auth_mode: "oauth",
          },
        },
      );
      const { id: serverId } = await createResponse.json() as { id: string };

      // When admin triggers OAuth discovery
      const discoverResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { method: "POST" },
      );

      // Then discovery succeeds with auth server details
      expect(discoverResponse.status).toBe(200);
      const body = await discoverResponse.json() as Record<string, unknown>;
      expect(body.discovered).toBe(true);
      expect(body.auth_server).toBe("https://auth.example.com");
      expect(body.authorization_endpoint).toBe("https://auth.example.com/authorize");
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Discover auth from WWW-Authenticate header on 401", () => {
  it.skip("falls back to WWW-Authenticate when .well-known is not available", async () => {
    // Given MCP server does NOT serve /.well-known/oauth-protected-resource
    // But returns 401 with WWW-Authenticate: Bearer resource_metadata="..."
    // When admin triggers discovery
    // Then Brain fetches resource_metadata URL from the header
    // And discovery succeeds
  }, 30_000);
});

describe("Auth server metadata with path component", () => {
  it.skip("tries multi-endpoint fallback for auth servers with path components", async () => {
    // Given auth server URL is "https://auth.example.com/tenant1"
    // When Brain discovers auth server metadata
    // Then Brain tries (in order):
    //   1. https://auth.example.com/.well-known/oauth-authorization-server/tenant1
    //   2. https://auth.example.com/.well-known/openid-configuration/tenant1
    //   3. https://auth.example.com/tenant1/.well-known/openid-configuration
    // And uses the first successful response
  }, 30_000);
});

describe("Discovery fails gracefully", () => {
  it.skip("returns discovered=false when no metadata is available", async () => {
    // Given MCP server does not serve Protected Resource Metadata
    // And does not return 401 with WWW-Authenticate
    // When admin triggers discovery
    // Then response is { discovered: false, error: "..." }
  }, 30_000);
});

describe("Auto-created credential_provider from discovery", () => {
  it.skip("creates a credential_provider with discovery_source set", async () => {
    // Given successful OAuth discovery for "https://mcp.example.com"
    // When discovery completes
    // Then a credential_provider record exists with:
    //   - discovery_source = "https://mcp.example.com"
    //   - authorization_url = discovered authorization_endpoint
    //   - token_url = discovered token_endpoint
  }, 30_000);
});
