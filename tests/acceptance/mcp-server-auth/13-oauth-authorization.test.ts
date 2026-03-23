/**
 * Acceptance Tests: OAuth 2.1 Authorization Flow (US-3, US-4)
 *
 * Milestone 3: Brain performs OAuth 2.1 authorization code flow with PKCE.
 * MSW simulates the authorization server's token endpoint.
 *
 * Traces: US-3, US-4, FR-3, FR-4, AC-3a..AC-3g, AC-4a..AC-4e
 * Driving ports:
 *   POST /api/workspaces/:wsId/mcp-servers/:id/authorize (initiate)
 *   GET  /oauth/callback (receive code)
 *
 * Implementation sequence:
 *   1. Generate authorization URL with PKCE S256                   [@skip]
 *   2. Exchange authorization code for tokens                      [@skip]
 *   3. Tokens encrypted and stored in connected_account            [@skip]
 *   4. Token refresh on expiry                                     [@skip]
 *   5. Refresh failure surfaces auth_error status                  [@skip]
 *   6. Dynamic client registration                                 [@skip]
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  setupMockMcpServer,
  getMcpServer,
} from "./mcp-server-auth-test-kit";

const getRuntime = setupAcceptanceSuite("mcp_server_auth_oauth_flow");

// ---------------------------------------------------------------------------
// Milestone 3: OAuth 2.1 Authorization Flow
// ---------------------------------------------------------------------------
describe("Generate authorization URL with PKCE S256", () => {
  it("returns authorization URL with code_challenge and state", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-auth-${crypto.randomUUID()}`);

    // Given: MCP server registered
    const mcpServerUrl = "https://mcp.example.com";
    const authServerUrl = "https://auth.example.com";
    const { msw } = setupMockMcpServer({ mcpServerUrl, authServerUrl });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Register an MCP server
      const createRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        { body: { name: "test-oauth-server", url: mcpServerUrl } },
      );
      expect(createRes.status).toBe(201);
      const { id: serverId } = (await createRes.json()) as { id: string };

      // Discover OAuth config (creates credential_provider linked to server)
      const discoverRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { body: {} },
      );
      expect(discoverRes.status).toBe(200);
      const discoverBody = (await discoverRes.json()) as {
        discovered: boolean;
        authorization_endpoint?: string;
        scopes_supported?: string[];
      };
      expect(discoverBody.discovered).toBe(true);

      // When: Initiate authorization
      const authorizeRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/authorize`,
        { body: {} },
      );
      expect(authorizeRes.status).toBe(200);
      const authorizeBody = (await authorizeRes.json()) as {
        redirect_url: string;
        state: string;
      };

      // Then: Response includes redirect_url and state
      expect(authorizeBody.state).toBeDefined();
      expect(typeof authorizeBody.state).toBe("string");
      expect(authorizeBody.state.length).toBeGreaterThan(0);

      expect(authorizeBody.redirect_url).toBeDefined();
      const redirectUrl = new URL(authorizeBody.redirect_url);

      // redirect_url points to the authorization_endpoint
      expect(redirectUrl.origin + redirectUrl.pathname).toBe(`${authServerUrl}/authorize`);

      // Contains code_challenge_method=S256
      expect(redirectUrl.searchParams.get("code_challenge_method")).toBe("S256");

      // Contains a code_challenge (base64url, no padding)
      const codeChallenge = redirectUrl.searchParams.get("code_challenge");
      expect(codeChallenge).toBeDefined();
      expect(codeChallenge!.length).toBeGreaterThan(0);
      // Base64url: only [A-Za-z0-9_-], no padding =
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);

      // Contains state matching the response body
      expect(redirectUrl.searchParams.get("state")).toBe(authorizeBody.state);

      // Contains resource parameter (RFC 8707) matching the MCP server URI
      expect(redirectUrl.searchParams.get("resource")).toBe(mcpServerUrl);

      // Contains scope parameter
      const scope = redirectUrl.searchParams.get("scope");
      expect(scope).toBeDefined();
      expect(scope!.length).toBeGreaterThan(0);

      // Contains response_type=code
      expect(redirectUrl.searchParams.get("response_type")).toBe("code");
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Exchange authorization code for tokens", () => {
  it("callback exchanges code using PKCE code_verifier", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-tok-${crypto.randomUUID()}`);

    // Given MSW mock auth server token endpoint
    const mcpServerUrl = "https://mcp.example.com";
    const authServerUrl = "https://auth.example.com";
    const { msw } = setupMockMcpServer({ mcpServerUrl, authServerUrl });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Register an MCP server
      const createRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        { body: { name: "test-callback-server", url: mcpServerUrl } },
      );
      expect(createRes.status).toBe(201);
      const { id: serverId } = (await createRes.json()) as { id: string };

      // Discover auth (creates credential_provider linked to server)
      const discoverRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { body: {} },
      );
      expect(discoverRes.status).toBe(200);
      const discoverBody = (await discoverRes.json()) as { discovered: boolean };
      expect(discoverBody.discovered).toBe(true);

      // Initiate authorization (stores PKCE verifier + state on mcp_server)
      const authorizeRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/authorize`,
        { body: {} },
      );
      expect(authorizeRes.status).toBe(200);
      const authorizeBody = (await authorizeRes.json()) as {
        redirect_url: string;
        state: string;
      };
      const { state } = authorizeBody;

      // Verify PKCE verifier was stored on the server record
      const serverBefore = await getMcpServer(surreal, serverId);
      expect(serverBefore?.pending_pkce_verifier).toBeDefined();
      expect(serverBefore?.pending_oauth_state).toBe(state);

      // When: OAuth callback receives code and state
      const callbackRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/oauth/callback`,
        { body: { code: "mock-auth-code-123", state } },
      );
      expect(callbackRes.status).toBe(200);
      const callbackBody = (await callbackRes.json()) as {
        access_token: string;
        token_type: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
      };

      // Then: Brain exchanged code at token_endpoint with code_verifier
      expect(callbackBody.access_token).toBeDefined();
      expect(callbackBody.access_token.length).toBeGreaterThan(0);
      expect(callbackBody.token_type).toBe("Bearer");
      expect(callbackBody.refresh_token).toBeDefined();

      // And pending PKCE state is cleared from the server record
      const serverAfter = await getMcpServer(surreal, serverId);
      expect(serverAfter?.pending_pkce_verifier).toBeUndefined();
      expect(serverAfter?.pending_oauth_state).toBeUndefined();
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Tokens encrypted and stored", () => {
  it.skip("access_token and refresh_token are encrypted in connected_account", async () => {
    // Given successful token exchange
    // When reading connected_account from SurrealDB
    // Then access_token_encrypted contains ciphertext, not plaintext
    // And refresh_token_encrypted contains ciphertext, not plaintext
    // And token_expires_at is set
  }, 30_000);
});

describe("Token refresh on expiry", () => {
  it.skip("automatically refreshes expired tokens before MCP connect", async () => {
    // Given MCP server with expired access_token but valid refresh_token
    // When credential resolver resolves auth for the server
    // Then Brain calls token_endpoint with grant_type=refresh_token
    // And new access_token is encrypted and stored
    // And returned headers include the new Bearer token
  }, 30_000);
});

describe("Refresh failure surfaces auth_error status", () => {
  it.skip("sets last_status to auth_error when refresh fails", async () => {
    // Given MCP server with expired access_token and expired refresh_token
    // When credential resolver attempts refresh
    // Then token_endpoint returns error
    // And MCP server last_status is set to "auth_error"
    // And GET /mcp-servers/:id/auth-status returns "expired"
  }, 30_000);
});

describe("Dynamic client registration", () => {
  it.skip("registers Brain as OAuth client when registration_endpoint exists", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dyn-${crypto.randomUUID()}`);

    // Given MSW mock auth server with registration_endpoint
    const { msw } = setupMockMcpServer({
      mcpServerUrl: "https://mcp.example.com",
      authServerUrl: "https://auth.example.com",
      supportsDynamicRegistration: true,
    });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // When Brain discovers auth and registration_endpoint is available
      // Then Brain POSTs to registration_endpoint with:
      //   - client_name: "Brain"
      //   - redirect_uris: [callback URL]
      //   - grant_types: ["authorization_code"]
      // And received client_id + client_secret are encrypted and stored
    } finally {
      msw.close();
    }
  }, 30_000);
});
