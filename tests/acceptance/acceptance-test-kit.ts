/**
 * Acceptance Test Kit — Shared Infrastructure
 *
 * Boots an in-process Brain server with isolated SurrealDB namespace.
 * All acceptance test suites (core, orchestrator, intent, coding-session, etc.)
 * build on this shared setup.
 */
import { afterAll, beforeAll } from "bun:test";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Surreal } from "surrealdb";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createBrainServer } from "../../app/src/server/runtime/start-server";
import { createRuntimeDependencies } from "../../app/src/server/runtime/dependencies";
import { createSseRegistry } from "../../app/src/server/streaming/sse-registry";
import { createInflightTracker } from "../../app/src/server/runtime/types";
import type { ServerConfig } from "../../app/src/server/runtime/config";
import type { ServerDependencies, InflightTracker } from "../../app/src/server/runtime/types";

// ── Shared AI dependencies for standalone acceptance tests ──

const openrouter = createOpenRouter({ apiKey: requireTestEnv("OPENROUTER_API_KEY") });

export const testAI = {
  openrouter,
  extractionModelId: requireTestEnv("EXTRACTION_MODEL"),
  extractionModel: openrouter(requireTestEnv("EXTRACTION_MODEL")),
  embeddingModel: openrouter.textEmbeddingModel(requireTestEnv("OPENROUTER_EMBEDDING_MODEL")),
  embeddingDimension: Number(requireTestEnv("EMBEDDING_DIMENSION")),
};

/** @deprecated Use `testAI` instead. */
export const smokeAI = testAI;

export type AcceptanceTestRuntime = {
  baseUrl: string;
  surreal: Surreal;
  namespace: string;
  database: string;
  port: number;
};

/** @deprecated Use `AcceptanceTestRuntime` instead. */
export type SmokeTestRuntime = AcceptanceTestRuntime;

export type AcceptanceSuiteOptions = {
  /** Extra env vars to set before the server boots (e.g. ORCHESTRATOR_MOCK_AGENT). */
  env?: Record<string, string>;
};

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

export function setupAcceptanceSuite(
  suiteName: string,
  options?: AcceptanceSuiteOptions,
): () => AcceptanceTestRuntime {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const namespace = `accept_${runId}`;
  const suiteSlug = suiteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const database = `${suiteSlug || "suite"}_${Math.floor(Math.random() * 100000)}`;

  let runtime: AcceptanceTestRuntime | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let runtimeSurreal: Surreal | undefined;
  let analyticsSurreal: Surreal | undefined;
  let inflight: InflightTracker | undefined;
  let setupSucceeded = false;

  beforeAll(async () => {
    // Apply env overrides before server boot
    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        process.env[k] = v;
      }
    }

    const surreal = new Surreal();
    await withTimeout(() => surreal.connect(surrealUrl), 10_000, "connect to SurrealDB");
    await withTimeout(
      () => surreal.signin({ username: surrealUsername, password: surrealPassword }),
      10_000,
      "authenticate with SurrealDB",
    );

    await withTimeout(() => surreal.query(`DEFINE NAMESPACE ${namespace};`), 10_000, "define test namespace");
    await withTimeout(() => surreal.use({ namespace }), 10_000, "switch to test namespace");
    await withTimeout(() => surreal.query(`DEFINE DATABASE ${database};`), 10_000, "define test database");
    await withTimeout(
      () => surreal.use({ namespace, database }),
      10_000,
      "switch to test namespace/database",
    );

    const schemaSql = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
    await withTimeout(() => surreal.query(schemaSql), 20_000, "apply schema");

    // Reserve a port so betterAuth gets the real URL at init time
    const tempServer = Bun.serve({ port: 0, fetch: () => new Response() });
    const reservedPort = tempServer.port;
    tempServer.stop(true);
    const baseUrl = `http://127.0.0.1:${reservedPort}`;

    const config: ServerConfig = {
      openRouterApiKey: requireTestEnv("OPENROUTER_API_KEY"),
      chatAgentModelId: requireTestEnv("CHAT_AGENT_MODEL"),
      extractionModelId: requireTestEnv("EXTRACTION_MODEL"),
      pmAgentModelId: process.env.PM_AGENT_MODEL?.trim() || requireTestEnv("EXTRACTION_MODEL"),
      analyticsAgentModelId: requireTestEnv("ANALYTICS_MODEL"),
      embeddingModelId: requireTestEnv("OPENROUTER_EMBEDDING_MODEL"),
      embeddingDimension: Number(requireTestEnv("EMBEDDING_DIMENSION")),
      extractionStoreThreshold: Number(requireTestEnv("EXTRACTION_STORE_THRESHOLD")),
      extractionDisplayThreshold: Number(requireTestEnv("EXTRACTION_DISPLAY_THRESHOLD")),
      surrealUrl,
      surrealUsername,
      surrealPassword,
      surrealNamespace: namespace,
      surrealDatabase: database,
      port: reservedPort,
      betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "smoke-test-secret-at-least-32-chars-long",
      betterAuthUrl: baseUrl,
      githubClientId: process.env.GITHUB_CLIENT_ID ?? "smoke-test-github-id",
      githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "smoke-test-github-secret",
    };

    const deps = await createRuntimeDependencies(config);
    runtimeSurreal = deps.surreal;
    analyticsSurreal = deps.analyticsSurreal;
    inflight = createInflightTracker();

    const serverDeps: ServerDependencies = {
      config,
      surreal: deps.surreal,
      analyticsSurreal: deps.analyticsSurreal,
      auth: deps.auth,
      chatAgentModel: deps.chatAgentModel,
      extractionModel: deps.extractionModel,
      pmAgentModel: deps.pmAgentModel,
      analyticsAgentModel: deps.analyticsAgentModel,
      embeddingModel: deps.embeddingModel,
      sse: createSseRegistry(),
      inflight,
    };

    server = createBrainServer(serverDeps);
    const port = server.port;

    runtime = { baseUrl, surreal, namespace, database, port };
    setupSucceeded = true;
  }, 60_000);

  afterAll(async () => {
    // Drain fire-and-forget work (e.g. webhook extraction) before closing DB
    if (inflight) {
      await inflight.drain(15_000);
    }

    if (server) {
      server.stop(true);
    }

    if (runtimeSurreal) {
      await runtimeSurreal.close().catch(() => undefined);
    }
    if (analyticsSurreal) {
      await analyticsSurreal.close().catch(() => undefined);
    }

    if (!runtime) {
      return;
    }

    if (setupSucceeded && !process.env.SMOKE_KEEP_DB) {
      try {
        await withTimeout(() => runtime!.surreal.query(`REMOVE DATABASE ${database};`), 10_000, "remove test database");
      } catch {
        // Best effort cleanup.
      }

      try {
        await withTimeout(() => runtime!.surreal.query(`REMOVE NAMESPACE ${namespace};`), 10_000, "remove test namespace");
      } catch {
        // Best effort cleanup.
      }
    }

    await withTimeout(() => runtime!.surreal.close(), 2_000, "close SurrealDB").catch(() => undefined);
  }, 20_000);

  return () => {
    if (!runtime) {
      throw new Error("Acceptance runtime requested before suite setup completed");
    }
    return runtime;
  };
}

/** @deprecated Use `setupAcceptanceSuite` instead. */
export const setupSmokeSuite = setupAcceptanceSuite;

// ---------------------------------------------------------------------------
// Auth Helpers
// ---------------------------------------------------------------------------

export type TestUser = {
  headers: Record<string, string>;
};

export async function createTestUser(baseUrl: string, suffix: string): Promise<TestUser> {
  const email = `test-${Date.now()}-${suffix}@test.local`;
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email, password: "test-password-123" }),
    redirect: "manual",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create test user (${response.status}): ${body}`);
  }

  const setCookie = response.headers.getSetCookie();
  if (!setCookie || setCookie.length === 0) {
    throw new Error("Sign-up did not return session cookies");
  }

  const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  return { headers: { Cookie: cookieHeader } };
}

// ---------------------------------------------------------------------------
// SSE Helpers
// ---------------------------------------------------------------------------

export async function collectSseEvents<T extends { type: string }>(streamUrl: string, timeoutMs: number): Promise<T[]> {
  const response = await fetch(streamUrl, { headers: { Accept: "text/event-stream" } });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: T[] = [];
  let buffer = "";

  const timeout = setTimeout(() => {
    void reader.cancel();
  }, timeoutMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const dataLine = segment.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) {
          continue;
        }

        const event = JSON.parse(dataLine.slice("data: ".length)) as T;
        events.push(event);

        if (event.type === "error") {
          const errorText = (event as { error?: string }).error;
          throw new Error(`SSE error event: ${errorText ?? "unknown error"}`);
        }

        if (event.type === "done") {
          return events;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  return events;
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) ${url}: ${body}`);
  }

  return (await response.json()) as T;
}

export async function fetchRaw(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

// ---------------------------------------------------------------------------
// OAuth Helpers
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Obtain an OAuth2 JWT access token for MCP endpoints.
 * Requires a SurrealDB connection to skip consent screen.
 */
export async function getOAuthToken(
  baseUrl: string,
  surreal: Surreal,
  sessionHeaders: Record<string, string>,
  scopes: string = "graph:read graph:reason session:write offline_access",
): Promise<string> {
  // Trigger JWKS key generation if not yet done
  await fetch(`${baseUrl}/api/auth/jwks`);

  const dcrRes = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: `test-client-${Date.now()}`,
      redirect_uris: ["http://127.0.0.1:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!dcrRes.ok) throw new Error(`DCR failed: ${dcrRes.status} ${await dcrRes.text()}`);

  const { client_id } = (await dcrRes.json()) as { client_id: string };

  await surreal.query(`UPDATE oauthClient SET skipConsent = true WHERE clientId = $cid;`, {
    cid: client_id,
  });

  const { verifier, challenge } = generatePkce();
  const authUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", "http://127.0.0.1:9999/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", "test-state");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", baseUrl);

  const authRes = await fetch(authUrl.toString(), {
    headers: sessionHeaders,
    redirect: "manual",
  });
  if (authRes.status !== 302) throw new Error(`Authorize did not redirect: ${authRes.status}`);

  const location = authRes.headers.get("location")!;
  const redirectUrl = new URL(location, baseUrl);
  const code = redirectUrl.searchParams.get("code") ?? "";
  if (!code) throw new Error(`No code in redirect: ${location}`);

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
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);

  const tokens = (await tokenRes.json()) as { access_token: string };
  return tokens.access_token;
}

export type TestUserWithMcp = TestUser & {
  mcpHeaders: Record<string, string>;
};

/**
 * Create a test user with both session cookie and OAuth MCP token.
 */
export async function createTestUserWithMcp(
  baseUrl: string,
  surreal: Surreal,
  suffix: string,
  scopes?: string,
): Promise<TestUserWithMcp> {
  const user = await createTestUser(baseUrl, suffix);
  const accessToken = await getOAuthToken(baseUrl, surreal, user.headers, scopes);
  return {
    ...user,
    mcpHeaders: { Authorization: `Bearer ${accessToken}` },
  };
}

// ---------------------------------------------------------------------------
// Internal Utilities
// ---------------------------------------------------------------------------

function requireTestEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Acceptance test requires env var ${name}`);
  }
  return value;
}

async function withTimeout<T>(callback: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    callback(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
    }),
  ]);
}
