import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

type ChatMessageResponse = {
  messageId: string;
  userMessageId: string;
  conversationId: string;
  workspaceId: string;
  streamUrl: string;
};

type StreamEvent =
  | { type: "assistant_message"; messageId: string; text: string }
  | { type: "extraction"; messageId: string; entities: Array<{ id: string; kind: string; text: string; confidence: number }> }
  | { type: "done"; messageId: string }
  | { type: "error"; messageId: string; error: string }
  | { type: string; messageId: string };

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

const testNamespace = `smoke_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const testDatabase = `pipeline_${Math.floor(Math.random() * 100000)}`;
const testPort = Number(process.env.SMOKE_PORT ?? "3107");
const baseUrl = `http://127.0.0.1:${testPort}`;

let surreal: Surreal;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let setupSucceeded = false;

beforeAll(async () => {
  surreal = new Surreal();
  await withTimeout(() => surreal.connect(surrealUrl), 10_000, "connect to SurrealDB");
  await withTimeout(
    () => surreal.signin({ username: surrealUsername, password: surrealPassword }),
    10_000,
    "authenticate with SurrealDB",
  );

  await withTimeout(() => surreal.query(`DEFINE NAMESPACE ${testNamespace};`), 10_000, "define test namespace");
  await withTimeout(
    () => surreal.use({ namespace: testNamespace, database: testDatabase }),
    10_000,
    "switch to test namespace/database",
  );
  await withTimeout(() => surreal.query(`DEFINE DATABASE ${testDatabase};`), 10_000, "define test database");

  const schemaSql = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await withTimeout(() => surreal.query(schemaSql), 20_000, "apply schema");

  serverProcess = Bun.spawn(["bun", "run", "app/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(testPort),
      SURREAL_NAMESPACE: testNamespace,
      SURREAL_DATABASE: testDatabase,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForHealth(baseUrl, serverProcess, 15_000);
  setupSucceeded = true;
}, 60_000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
    await serverProcess.exited;
  }

  if (!setupSucceeded) {
    await withTimeout(() => surreal.close(), 2_000, "close SurrealDB").catch(() => undefined);
    return;
  }

  try {
    await withTimeout(() => surreal.query(`REMOVE DATABASE ${testDatabase};`), 10_000, "remove test database");
  } catch {
    // Best effort cleanup.
  }

  try {
    await withTimeout(() => surreal.query(`REMOVE NAMESPACE ${testNamespace};`), 10_000, "remove test namespace");
  } catch {
    // Best effort cleanup.
  }

  await withTimeout(() => surreal.close(), 2_000, "close SurrealDB").catch(() => undefined);
}, 15_000);

describe("extraction pipeline smoke", () => {
  it("persists extraction artifacts for a user decision message", async () => {
    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Pipeline Smoke ${Date.now()}`,
        ownerDisplayName: "Marcus",
      }),
    });

    const message = await fetchJson<ChatMessageResponse>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: "I decided to use TypeScript over Rust for backend implementation.",
      }),
    });

    const events = await collectSseEvents(`${baseUrl}${message.streamUrl}`, 5_000);
    const extractionEvent = events.find((event) => event.type === "extraction") as Extract<StreamEvent, { type: "extraction" }> | undefined;
    const assistantEvent = events.find((event) => event.type === "assistant_message") as Extract<StreamEvent, { type: "assistant_message" }> | undefined;

    expect(extractionEvent).toBeDefined();
    expect(assistantEvent).toBeDefined();
    expect(extractionEvent?.entities.some((entity) => entity.kind === "decision")).toBe(true);

    const userMessageRecord = new RecordId("message", message.userMessageId);
    const [decisionRows] = await surreal
      .query<[Array<{ id: RecordId<"decision", string>; summary: string; embedding?: number[] }>]>(
        "SELECT id, summary, embedding FROM decision WHERE source_message = $sourceMessage;",
        { sourceMessage: userMessageRecord },
      )
      .collect<[Array<{ id: RecordId<"decision", string>; summary: string; embedding?: number[] }>]>();

    expect(decisionRows.length).toBeGreaterThan(0);
    expect(decisionRows[0].summary.length).toBeGreaterThan(0);
    expect(Array.isArray(decisionRows[0].embedding)).toBe(true);
    expect((decisionRows[0].embedding ?? []).length).toBeGreaterThan(0);

    const [edgeRows] = await surreal
      .query<[Array<{ id: RecordId<"extraction_relation", string>; evidence?: string }>]>(
        "SELECT id, evidence FROM extraction_relation WHERE `in` = $sourceMessage AND out = $decision LIMIT 1;",
        { sourceMessage: userMessageRecord, decision: decisionRows[0].id },
      )
      .collect<[Array<{ id: RecordId<"extraction_relation", string>; evidence?: string }>]>();

    expect(edgeRows.length).toBe(1);
    expect(typeof edgeRows[0].evidence).toBe("string");
    expect((edgeRows[0].evidence ?? "").length).toBeGreaterThan(0);

    const normalizedInput = normalizeText("I decided to use TypeScript over Rust for backend implementation.");
    const normalizedEvidence = normalizeText(edgeRows[0].evidence ?? "");
    expect(normalizedInput.includes(normalizedEvidence)).toBe(true);

    const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
    const [personRows] = await surreal
      .query<[Array<{ id: RecordId<"person", string> }>]>(
        "SELECT id FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
        { workspace: workspaceRecord },
      )
      .collect<[Array<{ id: RecordId<"person", string> }>]>() ;

    expect(personRows.length).toBe(1);
    expect((assistantEvent?.text ?? "").includes("```component")).toBe(true);
  }, 30_000);
});

async function collectSseEvents(streamUrl: string, timeoutMs: number): Promise<StreamEvent[]> {
  const response = await fetch(streamUrl, { headers: { Accept: "text/event-stream" } });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
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

        const event = JSON.parse(dataLine.slice(6)) as StreamEvent;
        events.push(event);

        if (event.type === "error") {
          throw new Error(`SSE error: ${event.error}`);
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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
    if (process.exitCode !== null) {
      throw new Error(`Smoke server exited early with code ${process.exitCode}`);
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function withTimeout<T>(
  callback: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return await Promise.race([
    callback(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
    }),
  ]);
}
