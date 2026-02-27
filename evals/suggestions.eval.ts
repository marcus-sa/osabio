import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { evalite } from "evalite";
import { afterAll, beforeAll } from "vitest";
import { Surreal } from "surrealdb";
import { suggestionGroundingScorer } from "./scorers/suggestion-grounding";
import { noGenericSuggestionsScorer } from "./scorers/no-generic-suggestions";
import { suggestionCountScorer } from "./scorers/suggestion-count";
import type { SuggestionGoldenCase, SuggestionsEvalOutput } from "./types";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";
const evalNamespace = `eval_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const evalDatabase = `suggestions_${Math.floor(Math.random() * 100000)}`;
const baseEvalPort = Number(process.env.EVAL_PORT ?? "3207");
const evalPort = Number(process.env.SUGGESTIONS_EVAL_PORT ?? String(baseEvalPort + 1));
const baseUrl = `http://127.0.0.1:${evalPort}`;
const assistantModel = process.env.ASSISTANT_MODEL ?? "unknown";
const schemaPath = join(process.cwd(), "schema", "surreal-schema.surql");

const cacheDir = process.env.EVAL_CACHE_DIR ?? "eval-results/cache";
const cachePath = join(cacheDir, "suggestions-cache.json");
const resultCache = loadCache(cachePath);
const cases = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "data", "suggestion-cases.json"), "utf8"),
) as SuggestionGoldenCase[];

let surreal: Surreal | undefined;
let evalServerProcess: ChildProcess | undefined;
let environmentReadyPromise: Promise<void> | undefined;
let teardownRegistered = false;

beforeAll(async () => {
  await ensureEvalEnvironment();
}, 120_000);

afterAll(async () => {
  await teardownEvalEnvironment();
}, 120_000);

evalite<SuggestionGoldenCase, SuggestionsEvalOutput, SuggestionGoldenCase>("Onboarding Suggestions Golden Cases", {
  data: cases.map((testCase) => ({ input: testCase, expected: testCase })),
  task: async (input) => runCase(input),
  scorers: [
    suggestionGroundingScorer,
    noGenericSuggestionsScorer,
    suggestionCountScorer,
  ],
  columns: ({ input, output, scores }) => [
    { label: "Model", value: assistantModel },
    { label: "Case", value: input.id },
    { label: "ExpectedMin", value: input.expectedMinSuggestions ?? 1 },
    { label: "Returned", value: output.suggestions.length },
    { label: "Grounded", value: formatScoreCell(scoreByName(scores, "suggestion-grounding")) },
    { label: "NoGeneric", value: formatScoreCell(scoreByName(scores, "no-generic-suggestions")) },
    { label: "Count", value: formatScoreCell(scoreByName(scores, "suggestion-count")) },
  ],
});

function scoreByName(
  scores: Array<{ name: string; score: number | null }>,
  name: string,
): number {
  const match = scores.find((score) => score.name === name);
  if (!match || match.score === null || Number.isNaN(match.score)) {
    throw new Error(`Missing score for scorer: ${name}`);
  }

  return match.score;
}

function formatScoreCell(value: number): string {
  return value.toFixed(2);
}

async function runCase(testCase: SuggestionGoldenCase): Promise<SuggestionsEvalOutput> {
  const cacheKey = buildCaseCacheKey(assistantModel, testCase);
  const cached = resultCache[cacheKey];
  if (cached) {
    return cached;
  }

  await ensureEvalEnvironment();

  const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Suggestions Eval ${testCase.id} ${Date.now()}`,
      ownerDisplayName: "Marcus",
    }),
  });

  const message = await fetchJson<{ streamUrl: string; messageId: string }>(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      workspaceId: workspace.workspaceId,
      conversationId: workspace.conversationId,
      text: testCase.input,
    }),
  });

  const events = await collectSseEvents(`${baseUrl}${message.streamUrl}`, 45_000);
  const assistantEvent = events.find((event) => event.type === "assistant_message") as
    | { type: "assistant_message"; text: string; suggestions?: string[] }
    | undefined;

  if (!assistantEvent) {
    const fallbackAssistant = await waitForAssistantMessage(message.messageId, 25_000);
    if (fallbackAssistant) {
      const output: SuggestionsEvalOutput = {
        caseId: testCase.id,
        input: testCase.input,
        assistantText: fallbackAssistant.text,
        suggestions: fallbackAssistant.suggestions ?? [],
      };

      resultCache[cacheKey] = output;
      saveCache(cachePath, resultCache);
      return output;
    }

    throw new Error(
      `Expected assistant_message event for suggestion eval case: ${testCase.id}; observed events: ${events.map((event) => event.type).join(", ")}`,
    );
  }

  const output: SuggestionsEvalOutput = {
    caseId: testCase.id,
    input: testCase.input,
    assistantText: assistantEvent.text,
    suggestions: assistantEvent.suggestions ?? [],
  };

  resultCache[cacheKey] = output;
  saveCache(cachePath, resultCache);
  return output;
}

async function getSurreal(): Promise<Surreal> {
  if (surreal) {
    return surreal;
  }

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.use({ namespace: evalNamespace, database: evalDatabase });
  return surreal;
}

type StreamEvent =
  | { type: "assistant_message"; text: string; suggestions?: string[] }
  | { type: "done" }
  | { type: "error"; error: string }
  | { type: string };

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
        const line = segment.split("\n").find((currentLine) => currentLine.startsWith("data: "));
        if (!line) {
          continue;
        }

        const event = JSON.parse(line.slice(6)) as StreamEvent;
        events.push(event);

        if (event.type === "error" && "error" in event) {
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

async function ensureEvalEnvironment(): Promise<void> {
  if (!environmentReadyPromise) {
    environmentReadyPromise = setupEvalEnvironment().catch((error) => {
      environmentReadyPromise = undefined;
      throw error;
    });
  }

  return environmentReadyPromise;
}

async function setupEvalEnvironment(): Promise<void> {
  const db = await getSurreal();
  await db.query(`DEFINE NAMESPACE ${evalNamespace};`).catch((error) => {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  });
  await db.use({ namespace: evalNamespace, database: evalDatabase });
  await db.query(`REMOVE DATABASE ${evalDatabase};`).catch(() => undefined);
  await db.query(`DEFINE DATABASE ${evalDatabase};`).catch((error) => {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  });
  await db.use({ namespace: evalNamespace, database: evalDatabase });

  const schemaSql = readFileSync(schemaPath, "utf8");
  await db.query(schemaSql).catch((error) => {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  });

  if (!evalServerProcess) {
    evalServerProcess = spawn("bun", ["run", "app/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(evalPort),
        SURREAL_NAMESPACE: evalNamespace,
        SURREAL_DATABASE: evalDatabase,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  await waitForHealth(`${baseUrl}/healthz`, evalServerProcess, 20_000);
  registerTeardown();
}

function registerTeardown(): void {
  if (teardownRegistered) {
    return;
  }
  teardownRegistered = true;

  const runTeardown = () => {
    void teardownEvalEnvironment();
  };

  process.once("exit", runTeardown);
  process.once("SIGINT", runTeardown);
  process.once("SIGTERM", runTeardown);
}

async function teardownEvalEnvironment(): Promise<void> {
  if (evalServerProcess) {
    evalServerProcess.kill();
    await waitForExit(evalServerProcess).catch(() => undefined);
    evalServerProcess = undefined;
  }

  const db = surreal;
  if (!db) {
    return;
  }

  await db.query(`REMOVE DATABASE ${evalDatabase};`).catch(() => undefined);
  await db.query(`REMOVE NAMESPACE ${evalNamespace};`).catch(() => undefined);
  await db.close().catch(() => undefined);
  surreal = undefined;
}

async function waitForHealth(url: string, processHandle: ChildProcess, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Eval server exited early with code ${processHandle.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for eval server health at ${url}`);
}

async function waitForExit(processHandle: ChildProcess): Promise<void> {
  if (processHandle.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    processHandle.once("exit", () => resolve());
    processHandle.once("error", reject);
  });
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("already exists");
}

function loadCache(path: string): Record<string, SuggestionsEvalOutput> {
  if (!existsSync(path)) {
    return {};
  }

  return JSON.parse(readFileSync(path, "utf8")) as Record<string, SuggestionsEvalOutput>;
}

function saveCache(path: string, cache: Record<string, SuggestionsEvalOutput>): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
}

function buildCaseCacheKey(modelId: string, testCase: SuggestionGoldenCase): string {
  const cacheVersion = "suggestions-v6";
  const caseHash = createHash("sha256").update(JSON.stringify(testCase)).digest("hex").slice(0, 24);
  return `${cacheVersion}:${modelId}:${testCase.id}:${caseHash}`;
}

async function waitForAssistantMessage(
  messageId: string,
  timeoutMs: number,
): Promise<{ text: string; suggestions?: string[] } | undefined> {
  const db = await getSurreal();
  const startedAt = Date.now();
  const messageRecord = new RecordId("message", messageId);

  while (Date.now() - startedAt < timeoutMs) {
    const [rows] = await db
      .query<[Array<{ id: RecordId<"message", string>; role: string; text: string; suggestions?: string[] }>]>(
        "SELECT id, role, text, suggestions FROM message WHERE id = $record LIMIT 1;",
        { record: messageRecord },
      )
      .collect<[Array<{ id: RecordId<"message", string>; role: string; text: string; suggestions?: string[] }>]>();

    const row = rows[0];
    if (row && row.role === "assistant") {
      return {
        text: row.text,
        ...(row.suggestions ? { suggestions: row.suggestions } : {}),
      };
    }

    await sleep(100);
  }

  return undefined;
}
