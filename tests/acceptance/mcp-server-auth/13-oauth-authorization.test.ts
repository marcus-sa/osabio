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
  it.skip("returns authorization URL with code_challenge and state", async () => {
    // Given MCP server with discovered OAuth config
    // When admin initiates authorization via POST /mcp-servers/:id/authorize
    // Then response includes:
    //   - redirect_url with authorization_endpoint
    //   - code_challenge_method=S256
    //   - state parameter
    //   - resource parameter (MCP server canonical URI, RFC 8707)
    //   - scope parameter
  }, 30_000);
});

describe("Exchange authorization code for tokens", () => {
  it.skip("callback exchanges code using PKCE code_verifier", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-tok-${crypto.randomUUID()}`);

    // Given MSW mock auth server token endpoint
    const { msw } = setupMockMcpServer({
      mcpServerUrl: "https://mcp.example.com",
      authServerUrl: "https://auth.example.com",
    });
    msw.listen({ onUnhandledRequest: "bypass" });

    try {
      // And admin has initiated authorization (state + code_verifier stored)
      // When OAuth callback receives code and state
      // Then Brain exchanges code at token_endpoint with code_verifier
      // And receives access_token + refresh_token
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
