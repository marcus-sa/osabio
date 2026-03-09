import { beforeAll, describe, expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { RecordId } from "surrealdb";
import { setupSmokeSuite } from "./smoke-test-kit";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const getRuntime = setupSmokeSuite("oauth-mcp-auth");

/** Sign up a test user and get a session token via better-auth API */
async function signUpAndGetSession(baseUrl: string, email: string, name: string): Promise<{
  userId: string;
  sessionToken: string;
  headers: Record<string, string>;
}> {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test-password-123!", name }),
  });

  if (!res.ok) {
    throw new Error(`Sign up failed: ${res.status} ${await res.text()}`);
  }

  // Sign-up returns user + session in JSON body
  const data = await res.json() as { user: { id: string }; token: string };

  // Also extract session cookie for subsequent requests
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find(c => c.startsWith("better-auth.session_token="));
  const sessionToken = sessionCookie
    ? decodeURIComponent(sessionCookie.split("=")[1].split(";")[0])
    : data.token;

  return {
    userId: data.user.id,
    sessionToken,
    headers: { Cookie: `better-auth.session_token=${sessionToken}` },
  };
}

/** Register an OAuth client via DCR and get tokens via the authorization flow */
async function getOAuthTokens(
  baseUrl: string,
  surreal: import("surrealdb").Surreal,
  sessionHeaders: Record<string, string>,
  scopes: string,
): Promise<{
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  // 1. Register a public client
  const dcrRes = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "test-client",
      redirect_uris: ["http://127.0.0.1:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!dcrRes.ok) {
    throw new Error(`DCR failed: ${dcrRes.status} ${await dcrRes.text()}`);
  }

  const { client_id } = await dcrRes.json() as { client_id: string };

  // Skip consent for test clients (authorize endpoint checks skip_consent on the client record)
  await surreal.query(
    `UPDATE oauthClient SET skipConsent = true WHERE clientId = $cid;`,
    { cid: client_id },
  );

  // 2. Get authorization code with PKCE (required for public clients)
  const { verifier, challenge } = generatePkce();
  const authUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", "http://127.0.0.1:9999/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", "test-state");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // Pass resource so better-auth issues a JWT access token (not opaque)
  authUrl.searchParams.set("resource", baseUrl);

  const authRes = await fetch(authUrl.toString(), {
    headers: sessionHeaders,
    redirect: "manual",
  });

  if (authRes.status !== 302) {
    const body = await authRes.text();
    throw new Error(`Authorize did not redirect: ${authRes.status} body=${body} headers=${JSON.stringify(Object.fromEntries(authRes.headers.entries()))}`);
  }

  const location = authRes.headers.get("location");
  if (!location) throw new Error("No location header in auth redirect");
  const redirectUrl = new URL(location, baseUrl);
  const code = redirectUrl.searchParams.get("code") ?? "";
  const error = redirectUrl.searchParams.get("error");
  if (!code) throw new Error(`No code in redirect: ${location} (error=${error})`);

  // 3. Exchange code for tokens
  const tokenRes = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://127.0.0.1:9999/callback",
      client_id,
      code_verifier: verifier,
      resource: baseUrl,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    clientId: client_id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  };
}

/** Helper: POST to an MCP endpoint with Bearer token */
function mcpPost(baseUrl: string, workspaceId: string, path: string, token: string, body: unknown = {}) {
  return fetch(`${baseUrl}/api/mcp/${workspaceId}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Helper: GET an MCP endpoint with Bearer token */
function mcpGet(baseUrl: string, workspaceId: string, path: string, token: string) {
  return fetch(`${baseUrl}/api/mcp/${workspaceId}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

describe("OAuth MCP Auth", () => {
  const ALL_SCOPES = "graph:read graph:reason decision:write task:write observation:write question:write session:write offline_access";
  let workspaceId: string;
  let fullToken: string;

  beforeAll(async () => {
    const { baseUrl, surreal } = getRuntime();

    // Create workspace with all required SCHEMAFULL fields
    workspaceId = crypto.randomUUID();
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `CREATE $ws CONTENT {
        name: "OAuth Test Workspace",
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };`,
      { ws: wsRecord },
    );

    // Create project linked to workspace
    const projRecord = new RecordId("project", crypto.randomUUID());
    await surreal.query(
      `CREATE $proj CONTENT {
        name: "Test Project",
        status: "active",
        workspace: $ws,
        created_at: time::now()
      };`,
      { proj: projRecord, ws: wsRecord },
    );
    await surreal.query(
      `RELATE $ws->has_project->$proj SET added_at = time::now();`,
      { ws: wsRecord, proj: projRecord },
    );

    // Sign up a user
    const { userId } = await signUpAndGetSession(baseUrl, "oauth-test@example.com", "OAuth Tester");

    // Create identity + spoke edge, then member_of (identity -> workspace)
    const personRecord = new RecordId("person", userId);
    const identityRecord = new RecordId("identity", crypto.randomUUID());
    await surreal.query(
      `CREATE $identity CONTENT { name: "OAuth Tester", type: "human", role: "admin", workspace: $ws, created_at: time::now() };`,
      { identity: identityRecord, ws: wsRecord },
    );
    await surreal.query(
      `RELATE $identity->identity_person->$person SET added_at = time::now();`,
      { identity: identityRecord, person: personRecord },
    );
    await surreal.query(
      `RELATE $identity->member_of->$ws SET role = "admin", added_at = time::now();`,
      { identity: identityRecord, ws: wsRecord },
    );

    // Trigger JWKS key generation by hitting the JWKS endpoint
    await fetch(`${baseUrl}/api/auth/jwks`);

    // Get OAuth tokens with all scopes
    const session = await signInAndGetSession(baseUrl, "oauth-test@example.com");
    const tokens = await getOAuthTokens(baseUrl, surreal, session.headers, ALL_SCOPES);
    fullToken = tokens.accessToken;
  }, 30_000);

  it("MCP route with valid JWT returns data", async () => {
    const { baseUrl } = getRuntime();
    const res = await mcpPost(baseUrl, workspaceId, "/workspace-context", fullToken);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("projects");
  });

  it("MCP route without token returns 401", async () => {
    const { baseUrl } = getRuntime();
    const res = await fetch(`${baseUrl}/api/mcp/${workspaceId}/workspace-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("MCP route with invalid token returns 401", async () => {
    const { baseUrl } = getRuntime();
    const res = await mcpPost(baseUrl, workspaceId, "/workspace-context", "invalid-jwt-token");
    expect(res.status).toBe(401);
  });

  it("MCP route with wrong workspace returns 403 or 404", async () => {
    const { baseUrl } = getRuntime();
    const res = await mcpPost(baseUrl, "nonexistent-workspace", "/workspace-context", fullToken);
    // Token's workspace claim won't match, so 403 or workspace not found 404
    expect([403, 404]).toContain(res.status);
  });

  it("scope enforcement: read-only token blocked from write routes", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Get a token with only graph:read scope
    const session = await signInAndGetSession(baseUrl, "oauth-test@example.com");
    const readOnlyTokens = await getOAuthTokens(baseUrl, surreal, session.headers, "graph:read offline_access");

    // Read should work
    const readRes = await mcpPost(baseUrl, workspaceId, "/workspace-context", readOnlyTokens.accessToken);
    expect(readRes.status).toBe(200);

    // Write should be blocked by scope
    const writeRes = await mcpPost(baseUrl, workspaceId, "/observations", readOnlyTokens.accessToken, {
      text: "test observation",
      category: "risk",
      severity: "info",
    });
    expect(writeRes.status).toBe(403);
    const body = await writeRes.json() as { error: string };
    expect(body.error).toContain("insufficient scope");
  }, 30_000);

  it("token refresh returns new access token", async () => {
    const { baseUrl, surreal } = getRuntime();

    const session = await signInAndGetSession(baseUrl, "oauth-test@example.com");
    const tokens = await getOAuthTokens(baseUrl, surreal, session.headers, ALL_SCOPES);

    // Refresh the token
    const refreshRes = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: tokens.clientId,
        resource: baseUrl,
      }),
    });

    expect(refreshRes.status).toBe(200);
    const refreshed = await refreshRes.json() as { access_token: string; expires_in: number };
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.expires_in).toBeGreaterThan(0);

    // New token should work on MCP routes
    const mcpRes = await mcpPost(baseUrl, workspaceId, "/workspace-context", refreshed.access_token);
    expect(mcpRes.status).toBe(200);
  }, 30_000);

  it(".well-known/oauth-protected-resource returns metadata", async () => {
    const { baseUrl } = getRuntime();
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const data = await res.json() as { scopes_supported: string[]; bearer_methods_supported: string[] };
    expect(data.scopes_supported).toContain("graph:read");
    expect(data.scopes_supported).toContain("decision:write");
    expect(data.bearer_methods_supported).toContain("header");
  });
});

/** Sign in an existing user and get session headers */
async function signInAndGetSession(baseUrl: string, email: string): Promise<{
  userId: string;
  sessionToken: string;
  headers: Record<string, string>;
}> {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test-password-123!" }),
  });

  if (!res.ok) {
    throw new Error(`Sign in failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { user: { id: string }; token: string };

  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find(c => c.startsWith("better-auth.session_token="));
  const sessionToken = sessionCookie
    ? decodeURIComponent(sessionCookie.split("=")[1].split(";")[0])
    : data.token;

  return {
    userId: data.user.id,
    sessionToken,
    headers: { Cookie: `better-auth.session_token=${sessionToken}` },
  };
}
