/**
 * Regression tests for OAuth callback flow fixes:
 *
 * Bug 1: redirect_uri was "/oauth/callback" — now workspace-scoped
 *         "/api/workspaces/:wsId/mcp-servers/oauth/callback"
 *
 * Bug 2: Post-OAuth redirect pointed to "/tool-registry?tab=servers"
 *         but the frontend route is "/tools?tab=servers"
 *
 * Bug 3: After successful token exchange, last_status was not set to "ok"
 */
import { describe, it, expect } from "bun:test";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import { createWorkspaceDirectly } from "../shared-fixtures";
import {
  createMcpServer,
  storePendingOAuthState,
  getMcpServerById,
  updateMcpServerProvider,
} from "../../../app/src/server/tool-registry/server-queries";
import { createProvider } from "../../../app/src/server/tool-registry/queries";

const getRuntime = setupAcceptanceSuite("oauth_callback", {
  configOverrides: {
    toolEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
});

describe("OAuth callback", () => {
  it("redirects to /tools?tab=servers&oauth=success and sets last_status to ok", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, workspaceRecord } = await createWorkspaceDirectly(surreal, "oauth-ok");

    // Start a mock token server that returns a valid token response
    const mockTokenServer = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          access_token: "mock-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read write",
        }),
    });

    try {
      const mockTokenUrl = `http://127.0.0.1:${mockTokenServer.port}/token`;
      const mockAuthServerUrl = `http://127.0.0.1:${mockTokenServer.port}`;

      // Create credential_provider pointing to mock token server
      const provider = await createProvider(surreal, workspaceRecord, {
        name: "test-oauth-provider",
        display_name: "Test OAuth Provider",
        auth_method: "oauth2",
        authorization_url: `${mockAuthServerUrl}/authorize`,
        token_url: mockTokenUrl,
        discovery_source: "https://mcp.example.com",
        client_id: "test-client-id",
        auth_server_url: mockAuthServerUrl,
      });

      // Create mcp_server with oauth auth_mode
      const server = await createMcpServer(surreal, workspaceRecord, {
        name: `oauth-test-server-${crypto.randomUUID().slice(0, 8)}`,
        url: "https://mcp.example.com",
        transport: "streamable-http",
        authMode: "oauth",
        providerRecord: provider.id,
      });

      // Link server to provider
      await updateMcpServerProvider(surreal, server.id, provider.id);

      // Store pending state with a code_verifier (simulating what startOAuthAuthorization does)
      const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
      const state = crypto.randomUUID();
      await storePendingOAuthState(surreal, server.id, codeVerifier, state);

      // Hit the OAuth callback endpoint (GET — simulating browser redirect from OAuth provider)
      const callbackUrl =
        `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/oauth/callback` +
        `?code=mock-auth-code&state=${state}`;

      const response = await fetch(callbackUrl, { redirect: "manual" });

      // Bug 2 regression: must redirect to /tools, not /tool-registry
      expect(response.status).toBe(302);
      const location = response.headers.get("location") ?? "";
      expect(location).toContain("/tools?tab=servers&oauth=success");
      expect(location).not.toContain("/tool-registry");

      // Bug 3 regression: last_status must be "ok" after successful exchange
      const updatedServer = await getMcpServerById(surreal, server.id, workspaceRecord);
      expect(updatedServer).toBeDefined();
      expect(updatedServer!.last_status).toBe("ok");
    } finally {
      mockTokenServer.stop(true);
    }
  });

  it("redirects to /tools on token exchange failure", async () => {
    const { baseUrl, surreal } = getRuntime();

    const { workspaceId, workspaceRecord } = await createWorkspaceDirectly(surreal, "oauth-fail");

    // Mock token server that returns an error
    const mockTokenServer = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });

    try {
      const mockTokenUrl = `http://127.0.0.1:${mockTokenServer.port}/token`;
      const mockAuthServerUrl = `http://127.0.0.1:${mockTokenServer.port}`;

      const provider = await createProvider(surreal, workspaceRecord, {
        name: "test-fail-provider",
        display_name: "Test Fail Provider",
        auth_method: "oauth2",
        authorization_url: `${mockAuthServerUrl}/authorize`,
        token_url: mockTokenUrl,
        discovery_source: "https://fail-mcp.example.com",
        client_id: "test-client-id",
        auth_server_url: mockAuthServerUrl,
      });

      const server = await createMcpServer(surreal, workspaceRecord, {
        name: `oauth-fail-server-${crypto.randomUUID().slice(0, 8)}`,
        url: "https://fail-mcp.example.com",
        transport: "streamable-http",
        authMode: "oauth",
        providerRecord: provider.id,
      });

      await updateMcpServerProvider(surreal, server.id, provider.id);

      const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
      const state = crypto.randomUUID();
      await storePendingOAuthState(surreal, server.id, codeVerifier, state);

      const callbackUrl =
        `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/oauth/callback` +
        `?code=bad-code&state=${state}`;

      const response = await fetch(callbackUrl, { redirect: "manual" });

      // Bug 2 regression: error redirect must also use /tools
      expect(response.status).toBe(302);
      const location = response.headers.get("location") ?? "";
      expect(location).toContain("/tools?tab=servers&oauth=error");
      expect(location).not.toContain("/tool-registry");
    } finally {
      mockTokenServer.stop(true);
    }
  });
});
