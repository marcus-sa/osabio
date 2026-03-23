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

const getRuntime = setupAcceptanceSuite("mcp_server_auth_oauth_flow", {
  configOverrides: {
    toolEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
});

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
    const { msw } = setupMockMcpServer({ mcpServerUrl, authServerUrl, supportsDynamicRegistration: true });
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
    const { msw } = setupMockMcpServer({ mcpServerUrl, authServerUrl, supportsDynamicRegistration: true });
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
  it("access_token and refresh_token are encrypted in connected_account", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-enc-${crypto.randomUUID()}`);

    // Given: MSW mock auth server
    const mcpServerUrl = "https://mcp.example.com";
    const authServerUrl = "https://auth.example.com";
    const { msw } = setupMockMcpServer({ mcpServerUrl, authServerUrl, supportsDynamicRegistration: true });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Register an MCP server
      const createRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        { body: { name: "test-encrypt-server", url: mcpServerUrl } },
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

      // Initiate authorization (stores PKCE verifier + state)
      const authorizeRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/authorize`,
        { body: {} },
      );
      expect(authorizeRes.status).toBe(200);
      const { state } = (await authorizeRes.json()) as { redirect_url: string; state: string };

      // When: OAuth callback exchanges code for tokens
      const callbackRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/oauth/callback`,
        { body: { code: "mock-auth-code-456", state } },
      );
      expect(callbackRes.status).toBe(200);
      const callbackBody = (await callbackRes.json()) as {
        access_token: string;
        refresh_token?: string;
      };

      // Then: connected_account exists with encrypted tokens
      const [accounts] = await surreal.query<[Array<Record<string, unknown>>]>(
        `SELECT * FROM connected_account WHERE workspace = $ws;`,
        { ws: new (await import("surrealdb")).RecordId("workspace", user.workspaceId) },
      );
      expect(accounts.length).toBeGreaterThanOrEqual(1);
      const account = accounts[0];

      // access_token_encrypted is present and does NOT contain the plaintext token
      expect(account.access_token_encrypted).toBeDefined();
      expect(typeof account.access_token_encrypted).toBe("string");
      expect((account.access_token_encrypted as string).length).toBeGreaterThan(0);
      expect(account.access_token_encrypted).not.toBe(callbackBody.access_token);
      expect(account.access_token_encrypted).not.toContain(callbackBody.access_token);

      // refresh_token_encrypted is present and does NOT contain the plaintext token
      expect(account.refresh_token_encrypted).toBeDefined();
      expect(typeof account.refresh_token_encrypted).toBe("string");
      expect((account.refresh_token_encrypted as string).length).toBeGreaterThan(0);
      expect(account.refresh_token_encrypted).not.toBe(callbackBody.refresh_token);
      expect(account.refresh_token_encrypted).not.toContain(callbackBody.refresh_token!);

      // token_expires_at is set
      expect(account.token_expires_at).toBeDefined();

      // status is active
      expect(account.status).toBe("active");

      // mcp_server.oauth_account is linked
      const serverAfter = await getMcpServer(surreal, serverId);
      expect(serverAfter?.oauth_account).toBeDefined();
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Token refresh on expiry", () => {
  it("automatically refreshes expired tokens before MCP connect", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-refresh-${crypto.randomUUID()}`);

    // Given: MSW mock auth server with token endpoint that handles refresh_token
    const mcpServerUrl = "https://mcp-refresh.example.com";
    const authServerUrl = "https://auth-refresh.example.com";
    const { msw } = setupMockMcpServer({ mcpServerUrl, authServerUrl, supportsDynamicRegistration: true });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Register an MCP server and complete OAuth flow to get tokens
      const createRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        { body: { name: "test-refresh-server", url: mcpServerUrl } },
      );
      expect(createRes.status).toBe(201);
      const { id: serverId } = (await createRes.json()) as { id: string };

      // Discover auth (creates credential_provider linked to server)
      const discoverRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { body: {} },
      );
      expect(discoverRes.status).toBe(200);

      // Initiate authorization
      const authorizeRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/authorize`,
        { body: {} },
      );
      expect(authorizeRes.status).toBe(200);
      const { state } = (await authorizeRes.json()) as { redirect_url: string; state: string };

      // Complete OAuth callback to get initial tokens stored
      const callbackRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/oauth/callback`,
        { body: { code: "mock-auth-code-refresh", state } },
      );
      expect(callbackRes.status).toBe(200);

      // Verify initial tokens are stored
      const serverAfterCallback = await getMcpServer(surreal, serverId);
      expect(serverAfterCallback?.oauth_account).toBeDefined();
      expect(serverAfterCallback?.auth_mode).toBe("oauth");

      const { RecordId: SurrealRecordId } = await import("surrealdb");

      // Read the connected_account to get its raw ID
      const [accounts] = await surreal.query<[Array<Record<string, unknown>>]>(
        `SELECT * FROM connected_account WHERE workspace = $ws;`,
        { ws: new SurrealRecordId("workspace", user.workspaceId) },
      );
      expect(accounts.length).toBeGreaterThanOrEqual(1);
      const account = accounts[0];

      // Store the old encrypted access token for comparison
      const oldAccessTokenEncrypted = account.access_token_encrypted as string;

      // Set token_expires_at to 5 minutes in the past (expired)
      await surreal.query(
        `UPDATE $acct SET token_expires_at = $expired;`,
        {
          acct: account.id,
          expired: new Date(Date.now() - 5 * 60 * 1000),
        },
      );

      // When: Call resolveAuthForMcpServer directly (the driving port for credential resolution)
      const { resolveAuthForMcpServer } = await import(
        "../../../app/src/server/proxy/credential-resolver"
      );
      const serverRecord = await getMcpServer(surreal, serverId);
      const headers = await resolveAuthForMcpServer(
        serverRecord as any,
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        { surreal, toolEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
      );

      // Then: Headers contain a Bearer token (from refresh)
      expect(headers).toBeDefined();
      expect(headers.Authorization).toBeDefined();
      expect(headers.Authorization).toMatch(/^Bearer mock-refreshed-token-/);

      // And: The connected_account has updated tokens in DB
      const [accountsAfter] = await surreal.query<[Array<Record<string, unknown>>]>(
        `SELECT * FROM connected_account WHERE workspace = $ws;`,
        { ws: new SurrealRecordId("workspace", user.workspaceId) },
      );
      expect(accountsAfter.length).toBeGreaterThanOrEqual(1);
      const accountAfter = accountsAfter[0];

      // The encrypted access token should have changed (new token from refresh)
      expect(accountAfter.access_token_encrypted).toBeDefined();
      expect(accountAfter.access_token_encrypted).not.toBe(oldAccessTokenEncrypted);

      // token_expires_at should be in the future now (refreshed)
      expect(accountAfter.token_expires_at).toBeDefined();
      const newExpiresAt = new Date(accountAfter.token_expires_at as string);
      expect(newExpiresAt.getTime()).toBeGreaterThan(Date.now());

      // Status should still be active
      expect(accountAfter.status).toBe("active");
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Refresh failure surfaces auth_error status", () => {
  it("sets last_status to auth_error when refresh fails", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-authfail-${crypto.randomUUID()}`);

    // Given: MSW mock auth server -- token endpoint will accept initial auth_code
    // but reject refresh_token requests (simulating expired refresh token)
    const mcpServerUrl = "https://mcp-authfail.example.com";
    const authServerUrl = "https://auth-authfail.example.com";
    const scopesSupported = ["read", "write"];

    // We need a custom MSW setup: initial token exchange succeeds, but refresh fails
    const { http, HttpResponse } = await import("msw");
    const { setupServer: setupMswServer } = await import("msw/node");

    let refreshAttempted = false;
    const handlers = [
      // Protected Resource Metadata
      http.get(`${mcpServerUrl}/.well-known/oauth-protected-resource`, () => {
        return HttpResponse.json({
          resource: mcpServerUrl,
          authorization_servers: [authServerUrl],
          scopes_supported: scopesSupported,
          bearer_methods_supported: ["header"],
        });
      }),
      // Auth Server Metadata
      http.get(`${authServerUrl}/.well-known/oauth-authorization-server`, () => {
        return HttpResponse.json({
          issuer: authServerUrl,
          authorization_endpoint: `${authServerUrl}/authorize`,
          token_endpoint: `${authServerUrl}/token`,
          registration_endpoint: `${authServerUrl}/register`,
          scopes_supported: scopesSupported,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      }),
      // Token endpoint: auth_code succeeds, refresh_token FAILS
      http.post(`${authServerUrl}/token`, async ({ request }) => {
        const body = await request.text();
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type");

        if (grantType === "authorization_code") {
          return HttpResponse.json({
            access_token: `mock-access-token-${crypto.randomUUID().slice(0, 8)}`,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: `mock-refresh-token-${crypto.randomUUID().slice(0, 8)}`,
            scope: scopesSupported.join(" "),
          });
        }

        if (grantType === "refresh_token") {
          refreshAttempted = true;
          // Simulate expired/invalid refresh token
          return HttpResponse.json(
            { error: "invalid_grant", error_description: "Refresh token expired" },
            { status: 400 },
          );
        }

        return HttpResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
      }),
      // Dynamic registration (RFC 7591) — required so provider gets a client_id
      http.post(`${authServerUrl}/register`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          client_id: `dynamic-client-${crypto.randomUUID().slice(0, 8)}`,
          client_name: body.client_name,
          redirect_uris: body.redirect_uris,
        });
      }),
    ];

    const msw = setupMswServer(...handlers);
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Register MCP server
      const createRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        { body: { name: "test-authfail-server", url: mcpServerUrl } },
      );
      expect(createRes.status).toBe(201);
      const { id: serverId } = (await createRes.json()) as { id: string };

      // Discover auth
      const discoverRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { body: {} },
      );
      expect(discoverRes.status).toBe(200);

      // Authorize
      const authorizeRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/authorize`,
        { body: {} },
      );
      expect(authorizeRes.status).toBe(200);
      const { state } = (await authorizeRes.json()) as { redirect_url: string; state: string };

      // Complete OAuth callback
      const callbackRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/oauth/callback`,
        { body: { code: "mock-auth-code-fail", state } },
      );
      expect(callbackRes.status).toBe(200);

      // Verify initial tokens are stored
      const serverAfterCallback = await getMcpServer(surreal, serverId);
      expect(serverAfterCallback?.oauth_account).toBeDefined();
      expect(serverAfterCallback?.auth_mode).toBe("oauth");

      const { RecordId: SurrealRecordId } = await import("surrealdb");

      // Read the connected_account
      const [accounts] = await surreal.query<[Array<Record<string, unknown>>]>(
        `SELECT * FROM connected_account WHERE workspace = $ws;`,
        { ws: new SurrealRecordId("workspace", user.workspaceId) },
      );
      expect(accounts.length).toBeGreaterThanOrEqual(1);
      const account = accounts[0];

      // Set token_expires_at to the past (expired access token)
      await surreal.query(
        `UPDATE $acct SET token_expires_at = $expired;`,
        {
          acct: account.id,
          expired: new Date(Date.now() - 5 * 60 * 1000),
        },
      );

      // When: Call resolveAuthForMcpServer -- it should attempt refresh, which will fail
      const { resolveAuthForMcpServer } = await import(
        "../../../app/src/server/proxy/credential-resolver"
      );
      const serverRecord = await getMcpServer(surreal, serverId);
      const headers = await resolveAuthForMcpServer(
        serverRecord as any,
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        { surreal, toolEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
      );

      // Then: No auth headers returned (refresh failed)
      expect(headers.Authorization).toBeUndefined();
      expect(refreshAttempted).toBe(true);

      // And: MCP server last_status is set to "auth_error"
      const serverAfterFailure = await getMcpServer(surreal, serverId);
      expect(serverAfterFailure?.last_status).toBe("auth_error");

      // And: connected_account status is "expired"
      const [accountsAfter] = await surreal.query<[Array<Record<string, unknown>>]>(
        `SELECT * FROM connected_account WHERE workspace = $ws;`,
        { ws: new SurrealRecordId("workspace", user.workspaceId) },
      );
      expect(accountsAfter[0].status).toBe("expired");

      // And: GET /mcp-servers/:id/auth-status returns "expired"
      const authStatusRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/auth-status`,
        { method: "GET" },
      );
      expect(authStatusRes.status).toBe(200);
      const authStatusBody = (await authStatusRes.json()) as { auth_status: string };
      expect(authStatusBody.auth_status).toBe("expired");
    } finally {
      msw.close();
    }
  }, 30_000);
});

describe("Dynamic client registration", () => {
  it("registers Brain as OAuth client when registration_endpoint exists", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dyn-${crypto.randomUUID()}`);

    // Given: MSW mock auth server with registration_endpoint
    const mcpServerUrl = "https://mcp-dynreg.example.com";
    const authServerUrl = "https://auth-dynreg.example.com";
    const { msw } = setupMockMcpServer({
      mcpServerUrl,
      authServerUrl,
      supportsDynamicRegistration: true,
    });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // Register an MCP server
      const createRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers`,
        { body: { name: "test-dynreg-server", url: mcpServerUrl } },
      );
      expect(createRes.status).toBe(201);
      const { id: serverId } = (await createRes.json()) as { id: string };

      // When: Brain discovers auth and registration_endpoint is available
      const discoverRes = await user.mcpFetch(
        `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}/discover-auth`,
        { body: {} },
      );
      expect(discoverRes.status).toBe(200);
      const discoverBody = (await discoverRes.json()) as {
        discovered: boolean;
        supports_dynamic_registration?: boolean;
        provider_id?: string;
      };
      expect(discoverBody.discovered).toBe(true);
      expect(discoverBody.supports_dynamic_registration).toBe(true);

      // Then: The credential_provider has client_id from dynamic registration
      const { RecordId: SurrealRecordId } = await import("surrealdb");
      const providerId = discoverBody.provider_id!;
      const [providers] = await surreal.query<[Array<Record<string, unknown>>]>(
        `SELECT * FROM $provider;`,
        { provider: new SurrealRecordId("credential_provider", providerId) },
      );
      expect(providers.length).toBe(1);
      const provider = providers[0];

      // client_id was set from dynamic registration response
      expect(provider.client_id).toBeDefined();
      expect(typeof provider.client_id).toBe("string");
      expect((provider.client_id as string).startsWith("dynamic-client-")).toBe(true);

      // client_secret was encrypted and stored
      expect(provider.client_secret_encrypted).toBeDefined();
      expect(typeof provider.client_secret_encrypted).toBe("string");
      expect((provider.client_secret_encrypted as string).length).toBeGreaterThan(0);

      // client_secret_encrypted should NOT contain the plaintext secret
      expect(provider.client_secret_encrypted).not.toContain("dynamic-secret-");
    } finally {
      msw.close();
    }
  }, 30_000);
});
