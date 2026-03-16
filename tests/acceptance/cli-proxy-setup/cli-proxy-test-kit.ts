/**
 * CLI Proxy Setup Acceptance Test Kit
 *
 * Domain-specific helpers for proxy token and CLI proxy setup tests.
 * Extends the shared acceptance-test-kit and llm-proxy-test-kit with
 * proxy token issuance, validation, and CLI config helpers.
 *
 * Driving ports:
 *   - POST /api/auth/proxy-token (issue proxy tokens)
 *   - POST /proxy/llm/anthropic/v1/messages (proxy with Brain auth)
 *   - CLI config files (~/.brain/config.json, .claude/settings.local.json)
 */
import { RecordId, type Surreal } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../acceptance-test-kit";
import {
  createProxyTestWorkspace,
  buildProxyRequestBody,
} from "../llm-proxy/llm-proxy-test-kit";

// Re-export shared helpers
export {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  createProxyTestWorkspace,
  type AcceptanceTestRuntime,
  type TestUser,
};

export type { ProxyTestUser };

// ---------------------------------------------------------------------------
// Proxy Token Issuance Helpers
// ---------------------------------------------------------------------------

export type ProxyTokenResponse = {
  proxy_token: string;
  expires_at: string;
  workspace_id: string;
};

/**
 * Request a proxy token from the server, simulating what `brain init` Step 7 does.
 *
 * The endpoint validates via Better Auth session cookies (not the Bearer value).
 * Pass sessionHeaders from createProxyTestUser() which contains Cookie header.
 * A dummy Authorization: Bearer header is included to satisfy the parse check.
 */
export async function requestProxyToken(
  baseUrl: string,
  sessionHeaders: Record<string, string>,
  workspaceId: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/proxy-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer session-via-cookie",
      ...sessionHeaders,
    },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

// ---------------------------------------------------------------------------
// Full Proxy Test User Setup
// ---------------------------------------------------------------------------

export type ProxyTestUser = {
  sessionHeaders: Record<string, string>;
  workspaceId: string;
  identityId: string;
  personId: string;
};

/**
 * Create a fully-wired test user for proxy token tests.
 *
 * Pipeline:
 *   1. Sign up via Better Auth → session cookies + person ID
 *   2. Create workspace
 *   3. Create identity with identity_person edge (person → identity)
 *   4. Create member_of edge (identity → workspace)
 *
 * Returns session headers (cookies) for use with requestProxyToken().
 */
export async function createProxyTestUser(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
): Promise<ProxyTestUser> {
  const workspaceId = `ws-${suffix}-${crypto.randomUUID()}`;
  const identityId = `id-${suffix}-${crypto.randomUUID()}`;

  // 1. Create real Better Auth user → session cookies
  const email = `proxy-${Date.now()}-${suffix}@test.local`;
  const signUpResponse = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Proxy Test User", email, password: "test-password-123" }),
    redirect: "manual",
  });

  if (!signUpResponse.ok) {
    const body = await signUpResponse.text();
    throw new Error(`Failed to create proxy test user (${signUpResponse.status}): ${body}`);
  }

  const setCookie = signUpResponse.headers.getSetCookie();
  if (!setCookie || setCookie.length === 0) {
    throw new Error("Sign-up did not return session cookies");
  }

  const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  const sessionHeaders: Record<string, string> = { Cookie: cookieHeader };

  // Extract person ID from sign-up response body
  const signUpBody = await signUpResponse.json() as { user?: { id?: string } };
  const personId = signUpBody.user?.id;
  if (!personId) {
    throw new Error("Sign-up response did not include user ID");
  }

  // 2. Create workspace
  await createProxyTestWorkspace(surreal, workspaceId);

  // 3. Create identity
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRec = new RecordId("workspace", workspaceId);
  const personRecord = new RecordId("person", personId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: "Proxy Test User",
      type: "human",
      role: "owner",
      workspace: workspaceRec,
      created_at: new Date(),
    },
  });

  // 4. Create identity_person edge (identity → person)
  await surreal.query(
    `RELATE $identity->identity_person->$person SET added_at = time::now();`,
    { identity: identityRecord, person: personRecord },
  );

  // 5. Create member_of edge (identity → workspace)
  await surreal.query(
    `RELATE $identity->member_of->$workspace SET role = "admin", added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRec },
  );

  return { sessionHeaders, workspaceId, identityId, personId };
}

// ---------------------------------------------------------------------------
// Brain-Auth Proxy Request Helpers
// ---------------------------------------------------------------------------

/**
 * Send a proxy request using Brain auth (X-Brain-Auth header) instead of
 * direct Anthropic API key. This is how Claude Code routes through the proxy
 * after `brain init` configures settings.local.json.
 */
export async function sendBrainAuthProxyRequest(
  baseUrl: string,
  proxyToken: string,
  options?: {
    model?: string;
    maxTokens?: number;
    messages?: Array<{ role: string; content: string }>;
    stream?: boolean;
  },
): Promise<Response> {
  const body = buildProxyRequestBody({
    model: options?.model ?? "claude-sonnet-4-20250514",
    maxTokens: options?.maxTokens ?? 20,
    messages: options?.messages ?? [{ role: "user", content: "Say exactly: test" }],
    stream: options?.stream ?? false,
  });

  return fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "X-Brain-Auth": proxyToken,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Proxy Token DB Helpers
// ---------------------------------------------------------------------------

export type ProxyTokenRecord = {
  id: RecordId;
  token_hash: string;
  workspace: RecordId;
  identity: RecordId;
  expires_at: Date;
  created_at: Date;
  revoked: boolean;
};

/**
 * Query all proxy tokens for an identity+workspace pair.
 */
export async function getProxyTokensForIdentity(
  surreal: Surreal,
  identityId: string,
  workspaceId: string,
): Promise<ProxyTokenRecord[]> {
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT * FROM proxy_token WHERE identity = $identity AND workspace = $ws ORDER BY created_at DESC;`,
    { identity: identityRecord, ws: workspaceRecord },
  );

  return (results[0] ?? []) as ProxyTokenRecord[];
}

/**
 * Count active (non-revoked, non-expired) proxy tokens for an identity+workspace.
 */
export async function countActiveProxyTokens(
  surreal: Surreal,
  identityId: string,
  workspaceId: string,
): Promise<number> {
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const results = await surreal.query(
    `SELECT count() AS total FROM proxy_token WHERE identity = $identity AND workspace = $ws AND revoked = false AND expires_at > time::now() GROUP ALL;`,
    { identity: identityRecord, ws: workspaceRecord },
  );

  const rows = (results[0] ?? []) as Array<{ total: number }>;
  return rows[0]?.total ?? 0;
}

/**
 * Seed an expired proxy token for testing expiry detection scenarios.
 */
export async function seedExpiredProxyToken(
  surreal: Surreal,
  tokenId: string,
  options: {
    tokenHash: string;
    workspaceId: string;
    identityId: string;
    expiredDaysAgo?: number;
  },
): Promise<string> {
  const tokenRecord = new RecordId("proxy_token", tokenId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);
  const identityRecord = new RecordId("identity", options.identityId);
  const daysAgo = options.expiredDaysAgo ?? 1;
  const expiredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  await surreal.query(`CREATE $tkn CONTENT $content;`, {
    tkn: tokenRecord,
    content: {
      token_hash: options.tokenHash,
      workspace: workspaceRecord,
      identity: identityRecord,
      expires_at: expiredAt,
      created_at: new Date(expiredAt.getTime() - 90 * 24 * 60 * 60 * 1000),
      revoked: false,
    },
  });

  return tokenId;
}

// ---------------------------------------------------------------------------
// CLI Config Simulation Helpers
// ---------------------------------------------------------------------------

/**
 * Build what brain init Step 7 should write to .claude/settings.local.json.
 * Used for asserting CLI output correctness.
 */
export function buildExpectedSettingsLocal(
  serverUrl: string,
  proxyToken: string,
): Record<string, unknown> {
  return {
    env: {
      ANTHROPIC_BASE_URL: `${serverUrl}/proxy/llm/anthropic`,
      ANTHROPIC_CUSTOM_HEADERS: `X-Brain-Auth: ${proxyToken}`,
    },
  };
}

/**
 * Build what brain init Step 7 should store in ~/.brain/config.json repo entry.
 */
export function buildExpectedRepoConfig(
  proxyToken: string,
  expiresAt: string,
): { proxy_token: string; proxy_token_expires_at: string } {
  return {
    proxy_token: proxyToken,
    proxy_token_expires_at: expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Identity + Workspace Setup (for OAuth simulation in tests)
// ---------------------------------------------------------------------------

/**
 * Create a test identity and workspace with member_of edge,
 * and return a simulated access token for proxy token issuance tests.
 *
 * Note: In real flow, access_token comes from OAuth. In acceptance tests,
 * we either use the acceptance-test-kit's createTestUser or seed directly.
 */
export async function createProxyTestIdentity(
  surreal: Surreal,
  options: {
    identityId: string;
    workspaceId: string;
    email?: string;
  },
): Promise<{ identityId: string; workspaceId: string }> {
  const identityRecord = new RecordId("identity", options.identityId);
  const workspaceRecord = new RecordId("workspace", options.workspaceId);

  // Create identity
  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name: `Test User ${options.identityId}`,
      type: "human",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  // Create member_of edge
  await surreal.query(
    `RELATE $identity->member_of->$workspace SET role = "admin", added_at = time::now();`,
    { identity: identityRecord, workspace: workspaceRecord },
  );

  return { identityId: options.identityId, workspaceId: options.workspaceId };
}
