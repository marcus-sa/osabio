import { afterAll, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Surreal } from "surrealdb";

export type SmokeTestRuntime = {
  baseUrl: string;
  surreal: Surreal;
  namespace: string;
  database: string;
  port: number;
};

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";
const smokePortBase = Number(process.env.SMOKE_PORT_BASE ?? "3100");

export function setupSmokeSuite(suiteName: string): () => SmokeTestRuntime {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const namespace = `smoke_${runId}`;
  const suiteSlug = suiteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const database = `${suiteSlug || "suite"}_${Math.floor(Math.random() * 100000)}`;

  let runtime: SmokeTestRuntime | undefined;
  let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
  let setupSucceeded = false;

  beforeAll(async () => {
    const port = process.env.SMOKE_PORT
      ? Number(process.env.SMOKE_PORT)
      : smokePortBase + Math.floor(Math.random() * 20000);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid smoke test port value: ${port}`);
    }
    const baseUrl = `http://127.0.0.1:${port}`;

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

    serverProcess = Bun.spawn(["bun", "run", "app/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        SURREAL_NAMESPACE: namespace,
        SURREAL_DATABASE: database,
        BETTER_AUTH_URL: baseUrl,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "smoke-test-secret-at-least-32-chars-long",
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "smoke-test-github-id",
        GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "smoke-test-github-secret",
      },
      stdout: "pipe",
      stderr: "inherit",
    });

    await waitForHealth(baseUrl, serverProcess, 15_000);
    runtime = { baseUrl, surreal, namespace, database, port };
    setupSucceeded = true;
  }, 60_000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
    }

    if (!runtime) {
      return;
    }

    if (setupSucceeded && !process.env.SMOKE_KEEP_DB) {
      try {
        await withTimeout(() => runtime.surreal.query(`REMOVE DATABASE ${database};`), 10_000, "remove test database");
      } catch {
        // Best effort cleanup.
      }

      try {
        await withTimeout(() => runtime.surreal.query(`REMOVE NAMESPACE ${namespace};`), 10_000, "remove test namespace");
      } catch {
        // Best effort cleanup.
      }
    }

    await withTimeout(() => runtime.surreal.close(), 2_000, "close SurrealDB").catch(() => undefined);
  }, 20_000);

  return () => {
    if (!runtime) {
      throw new Error("Smoke runtime requested before suite setup completed");
    }
    return runtime;
  };
}

export type TestUser = {
  headers: Record<string, string>;
};

export async function createTestUser(baseUrl: string, suffix: string): Promise<TestUser> {
  const email = `smoke-${Date.now()}-${suffix}@test.local`;
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke Tester", email, password: "smoke-test-password-123" }),
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

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) ${url}: ${body}`);
  }

  return (await response.json()) as T;
}

async function waitForHealth(url: string, process: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (typeof process.exitCode === "number") {
      const stderr = process.stderr ? await new Response(process.stderr).text() : "";
      throw new Error(`Smoke server exited early with code ${process.exitCode}\n${stderr}`);
    }

    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling.
    }

    await Bun.sleep(200);
  }

  throw new Error(`Timed out waiting for smoke server health at ${url}/healthz`);
}

async function withTimeout<T>(callback: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    callback(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
    }),
  ]);
}
