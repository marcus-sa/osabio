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
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  setupMockMcpServer,
} from "./mcp-server-auth-test-kit";
import { http, HttpResponse } from "msw";
import { setupServer as setupMswServer } from "msw/node";

const getRuntime = setupAcceptanceSuite("mcp_server_auth_oauth_discovery");

// ---------------------------------------------------------------------------
// Milestone 2: OAuth 2.1 Discovery
// ---------------------------------------------------------------------------
describe("Discover auth from Protected Resource Metadata", () => {
  it("fetches .well-known/oauth-protected-resource and auth server metadata", async () => {
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
            auth_mode: "none",
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
  it("falls back to WWW-Authenticate when .well-known is not available", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-www-auth-${crypto.randomUUID()}`);

    // Given MCP server does NOT serve /.well-known/oauth-protected-resource
    // But returns 401 with WWW-Authenticate: Bearer resource_metadata="..."
    // The resource_metadata URL in the header can be any URL (not necessarily the well-known path)
    const mcpServerUrl = "https://mcp-no-wellknown.example.com";
    const authServerUrl = "https://auth-wwwauth.example.com";
    const wellKnownUrl = `${mcpServerUrl}/.well-known/oauth-protected-resource`;
    const resourceMetadataUrl = `${mcpServerUrl}/oauth/resource-metadata`;

    const msw = setupMswServer(
      // Standard .well-known returns 404 (not available)
      http.get(wellKnownUrl, () => {
        return new HttpResponse(null, { status: 404 });
      }),

      // MCP server returns 401 with WWW-Authenticate header pointing to resource metadata
      http.post(mcpServerUrl, () => {
        return new HttpResponse(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
          },
        });
      }),

      // The resource_metadata URL (from WWW-Authenticate) returns Protected Resource Metadata
      http.get(resourceMetadataUrl, () => {
        return HttpResponse.json({
          resource: mcpServerUrl,
          authorization_servers: [authServerUrl],
          scopes_supported: ["tools:read"],
          bearer_methods_supported: ["header"],
        });
      }),

      // Auth server metadata
      http.get(`${authServerUrl}/.well-known/oauth-authorization-server`, () => {
        return HttpResponse.json({
          issuer: authServerUrl,
          authorization_endpoint: `${authServerUrl}/authorize`,
          token_endpoint: `${authServerUrl}/token`,
          scopes_supported: ["tools:read"],
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code"],
        });
      }),
    );
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // And an MCP server record exists
      const createResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        {
          method: "POST",
          body: {
            name: "www-auth-test",
            url: mcpServerUrl,
            transport: "streamable-http",
            auth_mode: "none",
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
      expect(body.auth_server).toBe(authServerUrl);
      expect(body.authorization_endpoint).toBe(`${authServerUrl}/authorize`);
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Auth server metadata with path component", () => {
  it("tries multi-endpoint fallback for auth servers with path components", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-fallback-${crypto.randomUUID()}`);

    // Given auth server URL has a path component: /tenant1
    const mcpServerUrl = "https://mcp-tenant.example.com";
    const authServerUrl = "https://auth-tenant.example.com/tenant1";

    // Derived endpoints (per RFC 8414 + OIDC):
    //   1. https://auth-tenant.example.com/.well-known/oauth-authorization-server/tenant1  -> 404
    //   2. https://auth-tenant.example.com/.well-known/openid-configuration/tenant1        -> 200 (success)
    //   3. https://auth-tenant.example.com/tenant1/.well-known/openid-configuration        -> (not tried)

    const msw = setupMswServer(
      // Protected Resource Metadata points to auth server with path
      http.get(`${mcpServerUrl}/.well-known/oauth-protected-resource`, () => {
        return HttpResponse.json({
          resource: mcpServerUrl,
          authorization_servers: [authServerUrl],
          scopes_supported: ["tools:read"],
          bearer_methods_supported: ["header"],
        });
      }),

      // First endpoint: RFC 8414 path-based -> 404
      http.get(
        "https://auth-tenant.example.com/.well-known/oauth-authorization-server/tenant1",
        () => new HttpResponse(null, { status: 404 }),
      ),

      // Second endpoint: OIDC path-based -> succeeds
      http.get(
        "https://auth-tenant.example.com/.well-known/openid-configuration/tenant1",
        () => {
          return HttpResponse.json({
            issuer: authServerUrl,
            authorization_endpoint: `${authServerUrl}/authorize`,
            token_endpoint: `${authServerUrl}/token`,
            scopes_supported: ["tools:read"],
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
            grant_types_supported: ["authorization_code"],
          });
        },
      ),
    );
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // And an MCP server record exists
      const createResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        {
          method: "POST",
          body: {
            name: "tenant-fallback-test",
            url: mcpServerUrl,
            transport: "streamable-http",
            auth_mode: "none",
          },
        },
      );
      const { id: serverId } = await createResponse.json() as { id: string };

      // When admin triggers OAuth discovery
      const discoverResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { method: "POST" },
      );

      // Then discovery succeeds using the second fallback endpoint
      expect(discoverResponse.status).toBe(200);
      const body = await discoverResponse.json() as Record<string, unknown>;
      expect(body.discovered).toBe(true);
      expect(body.auth_server).toBe(authServerUrl);
      expect(body.authorization_endpoint).toBe(`${authServerUrl}/authorize`);
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Discovery fails gracefully", () => {
  it("returns discovered=false when no metadata is available", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-no-meta-${crypto.randomUUID()}`);

    // Given MCP server does NOT serve Protected Resource Metadata
    // And does NOT return 401 with WWW-Authenticate (returns 200 instead)
    const mcpServerUrl = "https://mcp-no-auth.example.com";
    const wellKnownUrl = `${mcpServerUrl}/.well-known/oauth-protected-resource`;

    const msw = setupMswServer(
      // .well-known/oauth-protected-resource returns 404
      http.get(wellKnownUrl, () => {
        return new HttpResponse(null, { status: 404 });
      }),

      // MCP server returns 200 (no 401, no WWW-Authenticate)
      http.post(mcpServerUrl, () => {
        return HttpResponse.json({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [] },
        });
      }),
    );
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // And an MCP server record exists
      const createResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        {
          method: "POST",
          body: {
            name: "no-auth-test",
            url: mcpServerUrl,
            transport: "streamable-http",
            auth_mode: "none",
          },
        },
      );
      const { id: serverId } = await createResponse.json() as { id: string };

      // When admin triggers OAuth discovery
      const discoverResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { method: "POST" },
      );

      // Then discovery returns discovered=false with a descriptive error
      expect(discoverResponse.status).toBe(200);
      const body = await discoverResponse.json() as Record<string, unknown>;
      expect(body.discovered).toBe(false);
      expect(typeof body.error).toBe("string");
      expect((body.error as string).length).toBeGreaterThan(0);
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Auto-created credential_provider from discovery", () => {
  it("creates a credential_provider with discovery_source set", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-auto-prov-${crypto.randomUUID()}`);

    // Given MSW mock MCP server with Protected Resource Metadata
    const mcpServerUrl = "https://mcp-auto-provider.example.com";
    const authServerUrl = "https://auth-auto-provider.example.com";

    const { msw } = setupMockMcpServer({
      mcpServerUrl,
      authServerUrl,
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
            name: "auto-provider-test",
            url: mcpServerUrl,
            transport: "streamable-http",
            auth_mode: "none",
          },
        },
      );
      const { id: serverId } = await createResponse.json() as { id: string };

      // When admin triggers OAuth discovery
      const discoverResponse = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { method: "POST" },
      );

      // Then discovery succeeds
      expect(discoverResponse.status).toBe(200);
      const body = await discoverResponse.json() as Record<string, unknown>;
      expect(body.discovered).toBe(true);
      expect(body.provider_id).toBeDefined();

      // And a credential_provider record exists with discovery_source set
      const providerRecord = new RecordId("credential_provider", body.provider_id as string);
      const [providerRows] = await surreal.query<[Array<Record<string, unknown>>]>(
        "SELECT * FROM $provider;",
        { provider: providerRecord },
      );
      const provider = providerRows[0];
      expect(provider).toBeDefined();
      expect(provider.discovery_source).toBe(mcpServerUrl);
      expect(provider.authorization_url).toBe(`${authServerUrl}/authorize`);
      expect(provider.token_url).toBe(`${authServerUrl}/token`);
      expect(provider.auth_method).toBe("oauth2");

      // And the MCP server is linked to the provider with auth_mode = "oauth"
      const serverRecord = new RecordId("mcp_server", serverId);
      const [serverRows] = await surreal.query<[Array<Record<string, unknown>>]>(
        "SELECT * FROM $server;",
        { server: serverRecord },
      );
      const server = serverRows[0];
      expect(server.auth_mode).toBe("oauth");
      expect(server.provider).toBeDefined();
    } finally {
      msw.close();
    }
  }, 30_000);
});
