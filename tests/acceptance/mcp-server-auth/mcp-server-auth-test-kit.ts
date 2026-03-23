/**
 * MCP Server Auth Acceptance Test Kit
 *
 * Domain-specific helpers for MCP server authentication acceptance tests.
 * Uses MSW to simulate external MCP servers and OAuth authorization servers.
 *
 * Driving ports:
 *   POST   /api/workspaces/:wsId/mcp-servers                     (create MCP server with auth)
 *   PUT    /api/workspaces/:wsId/mcp-servers/:id/headers          (update static headers)
 *   POST   /api/workspaces/:wsId/mcp-servers/:id/discover-auth    (trigger OAuth discovery)
 *   GET    /api/workspaces/:wsId/mcp-servers/:id/auth-status      (auth status)
 *   GET    /oauth/callback                                        (OAuth callback)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  type AcceptanceTestRuntime,
  type TestUserWithMcp,
} from "../acceptance-test-kit";
import { http, HttpResponse } from "msw";
import { setupServer as setupMswServer } from "msw/node";

// Re-export shared helpers
export {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  type AcceptanceTestRuntime,
  type TestUserWithMcp,
};

// ---------------------------------------------------------------------------
// MSW Mock OAuth/MCP Server
// ---------------------------------------------------------------------------

export type MockMcpServerConfig = {
  /** Base URL the mock MCP server listens on (e.g. https://mcp.example.com) */
  mcpServerUrl: string;
  /** Base URL of the mock auth server (e.g. https://auth.example.com) */
  authServerUrl?: string;
  /** Scopes the protected resource supports */
  scopesSupported?: string[];
  /** Whether the auth server supports dynamic registration */
  supportsDynamicRegistration?: boolean;
  /** Expected authorization header value for authenticated requests */
  expectedAuthHeader?: string;
  /** Captured requests for assertion */
  capturedRequests?: CapturedRequest[];
};

export type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

/**
 * Creates MSW handlers that simulate an MCP server with OAuth 2.1 support.
 *
 * - Protected Resource Metadata at /.well-known/oauth-protected-resource
 * - Auth Server Metadata at /.well-known/oauth-authorization-server
 * - Token endpoint at /token
 * - Optional dynamic registration at /register
 * - MCP endpoint that requires auth (returns 401 without, 200 with)
 */
export function createMockMcpHandlers(config: MockMcpServerConfig) {
  const {
    mcpServerUrl,
    authServerUrl = "https://auth.example.com",
    scopesSupported = ["read", "write"],
    supportsDynamicRegistration = false,
    expectedAuthHeader,
    capturedRequests = [],
  } = config;

  return [
    // Protected Resource Metadata (RFC 9728)
    http.get(`${mcpServerUrl}/.well-known/oauth-protected-resource`, () => {
      return HttpResponse.json({
        resource: mcpServerUrl,
        authorization_servers: [authServerUrl],
        scopes_supported: scopesSupported,
        bearer_methods_supported: ["header"],
      });
    }),

    // Auth Server Metadata (RFC 8414)
    http.get(`${authServerUrl}/.well-known/oauth-authorization-server`, () => {
      const metadata: Record<string, unknown> = {
        issuer: authServerUrl,
        authorization_endpoint: `${authServerUrl}/authorize`,
        token_endpoint: `${authServerUrl}/token`,
        scopes_supported: scopesSupported,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
      };

      if (supportsDynamicRegistration) {
        metadata.registration_endpoint = `${authServerUrl}/register`;
      }

      return HttpResponse.json(metadata);
    }),

    // Token endpoint — validates code + code_verifier, returns tokens
    http.post(`${authServerUrl}/token`, async ({ request }) => {
      const body = await request.text();
      const params = new URLSearchParams(body);
      const grantType = params.get("grant_type");

      if (grantType === "authorization_code") {
        const code = params.get("code");
        const codeVerifier = params.get("code_verifier");

        if (!code || !codeVerifier) {
          return HttpResponse.json(
            { error: "invalid_request", error_description: "Missing code or code_verifier" },
            { status: 400 },
          );
        }

        return HttpResponse.json({
          access_token: `mock-access-token-${crypto.randomUUID().slice(0, 8)}`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: `mock-refresh-token-${crypto.randomUUID().slice(0, 8)}`,
          scope: scopesSupported.join(" "),
        });
      }

      if (grantType === "refresh_token") {
        const refreshToken = params.get("refresh_token");
        if (!refreshToken) {
          return HttpResponse.json(
            { error: "invalid_grant", error_description: "Missing refresh_token" },
            { status: 400 },
          );
        }

        return HttpResponse.json({
          access_token: `mock-refreshed-token-${crypto.randomUUID().slice(0, 8)}`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: `mock-refresh-token-${crypto.randomUUID().slice(0, 8)}`,
        });
      }

      return HttpResponse.json(
        { error: "unsupported_grant_type" },
        { status: 400 },
      );
    }),

    // Dynamic registration (RFC 7591)
    http.post(`${authServerUrl}/register`, async ({ request }) => {
      if (!supportsDynamicRegistration) {
        return new HttpResponse(null, { status: 404 });
      }

      const body = await request.json() as Record<string, unknown>;
      return HttpResponse.json({
        client_id: `dynamic-client-${crypto.randomUUID().slice(0, 8)}`,
        client_secret: `dynamic-secret-${crypto.randomUUID().slice(0, 8)}`,
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
      });
    }),

    // MCP server endpoint — requires auth, captures requests
    http.post(mcpServerUrl, ({ request }) => {
      capturedRequests.push({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      });

      const authHeader = request.headers.get("authorization");

      if (expectedAuthHeader && authHeader !== expectedAuthHeader) {
        return new HttpResponse(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${mcpServerUrl}/.well-known/oauth-protected-resource"`,
          },
        });
      }

      // Return a valid MCP tools/list response
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: 1,
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
    }),
  ];
}

/**
 * Sets up MSW server with mock MCP/OAuth handlers.
 * Returns the server and captured requests array.
 */
export function setupMockMcpServer(config: MockMcpServerConfig) {
  const capturedRequests: CapturedRequest[] = [];
  const handlers = createMockMcpHandlers({ ...config, capturedRequests });
  const msw = setupMswServer(...handlers);
  return { msw, capturedRequests };
}

// ---------------------------------------------------------------------------
// SurrealDB Seed Helpers
// ---------------------------------------------------------------------------

export type SeedMcpServerOptions = {
  name: string;
  url: string;
  transport?: "sse" | "streamable-http";
  authMode?: "none" | "static_headers" | "oauth" | "provider";
  staticHeaders?: Array<{ name: string; value_encrypted: string }>;
  workspaceId: string;
};

/**
 * Seed an mcp_server record directly in SurrealDB.
 */
export async function seedMcpServer(
  surreal: Surreal,
  serverId: string,
  options: SeedMcpServerOptions,
): Promise<string> {
  const serverRecord = new RecordId("mcp_server", serverId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  const content: Record<string, unknown> = {
    name: options.name,
    url: options.url,
    transport: options.transport ?? "streamable-http",
    auth_mode: options.authMode ?? "none",
    workspace: workspaceRecord,
    tool_count: 0,
    created_at: new Date(),
  };

  if (options.staticHeaders) {
    content.static_headers = options.staticHeaders;
  }

  await surreal.query("CREATE $server CONTENT $content;", {
    server: serverRecord,
    content,
  });

  return serverId;
}

/**
 * Read an mcp_server record directly from SurrealDB.
 */
export async function getMcpServer(
  surreal: Surreal,
  serverId: string,
): Promise<Record<string, unknown> | undefined> {
  const serverRecord = new RecordId("mcp_server", serverId);
  const [rows] = await surreal.query<[Array<Record<string, unknown>>]>(
    "SELECT * FROM $server;",
    { server: serverRecord },
  );
  return rows[0];
}
