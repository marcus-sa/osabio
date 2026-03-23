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
import { RecordId } from "surrealdb";
import { setupAcceptanceSuite } from "../acceptance-test-kit";
import {
  createMcpServer,
  storePendingOAuthState,
  getMcpServerById,
  updateMcpServerProvider,
} from "../../../app/src/server/tool-registry/server-queries";
import { createProvider } from "../../../app/src/server/tool-registry/queries";
import { generatePkce } from "../../../app/src/server/tool-registry/oauth-flow";

const getRuntime = setupAcceptanceSuite("oauth_callback");

describe("OAuth callback", () => {
  it("redirects to /tools?tab=servers&oauth=success and sets last_status to ok", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Create workspace record
    const workspaceId = crypto.randomUUID();
    const workspaceRecord = new RecordId("workspace", workspaceId);
    await surreal.query("CREATE $ws CONTENT $content;", {
      ws: workspaceRecord,
      content: { name: "test-oauth-ws", created_at: new Date() },
    });

    // Create identity + member_of edge (required by some queries)
    const identityId = crypto.randomUUID();
    const identityRecord = new RecordId("identity", identityId);
    await surreal.query("CREATE $id CONTENT $content;", {
      id: identityRecord,
      content: { email: `oauth-test-${identityId}@test.local`, created_at: new Date() },
    });
    await surreal.query("RELATE $identity->member_of->$ws;", {
      identity: identityRecord,
      ws: workspaceRecord,
    });

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

      // Create credential_provider pointing to mock token server
      const provider = await createProvider(surreal, workspaceRecord, {
        name: "test-oauth-provider",
        display_name: "Test OAuth Provider",
        auth_method: "oauth2",
        authorization_url: "https://auth.example.com/authorize",
        token_url: mockTokenUrl,
        discovery_source: "https://mcp.example.com",
        client_id: "test-client-id",
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

      // Generate real PKCE and store pending state
      const pkce = await generatePkce();
      const state = crypto.randomUUID();
      await storePendingOAuthState(surreal, server.id, pkce.codeVerifier, state);

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

    // Create workspace
    const workspaceId = crypto.randomUUID();
    const workspaceRecord = new RecordId("workspace", workspaceId);
    await surreal.query("CREATE $ws CONTENT $content;", {
      ws: workspaceRecord,
      content: { name: "test-oauth-fail-ws", created_at: new Date() },
    });

    // Mock token server that returns an error
    const mockTokenServer = Bun.serve({
      port: 0,
      fetch: () => new Response("invalid_grant", { status: 400 }),
    });

    try {
      const mockTokenUrl = `http://127.0.0.1:${mockTokenServer.port}/token`;

      const provider = await createProvider(surreal, workspaceRecord, {
        name: "test-fail-provider",
        display_name: "Test Fail Provider",
        auth_method: "oauth2",
        authorization_url: "https://auth.example.com/authorize",
        token_url: mockTokenUrl,
        discovery_source: "https://fail-mcp.example.com",
        client_id: "test-client-id",
      });

      const server = await createMcpServer(surreal, workspaceRecord, {
        name: `oauth-fail-server-${crypto.randomUUID().slice(0, 8)}`,
        url: "https://fail-mcp.example.com",
        transport: "streamable-http",
        authMode: "oauth",
        providerRecord: provider.id,
      });

      await updateMcpServerProvider(surreal, server.id, provider.id);

      const pkce = await generatePkce();
      const state = crypto.randomUUID();
      await storePendingOAuthState(surreal, server.id, pkce.codeVerifier, state);

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
