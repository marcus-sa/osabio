import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { evalite, createScorer } from "evalite";
import { Factuality } from "autoevals";
import { afterAll, beforeAll } from "vitest";
import { RecordId, Surreal } from "surrealdb";
import { entityPrecisionScorer } from "./scorers/entity-precision";
import { entityRecallScorer } from "./scorers/entity-recall";
import { noPhantomPersonsScorer } from "./scorers/no-phantom-persons";
import { evidenceGroundedScorer } from "./scorers/evidence-grounded";
import { noPlaceholdersScorer } from "./scorers/no-placeholders";
import type { ExtractionEvalOutput, GoldenCase } from "./types";
import { normalizeForSubstring } from "./scorers/shared";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";
const evalNamespace = `eval_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const evalDatabase = `extraction_${Math.floor(Math.random() * 100000)}`;
const evalPort = Number(process.env.EVAL_PORT ?? "3207");
const baseUrl = `http://127.0.0.1:${evalPort}`;
const extractionModel = process.env.EXTRACTION_MODEL ?? "anthropic/claude-3.5-haiku";
const autoevalModel = requireEnv("AUTOEVAL_MODEL");
const schemaPath = join(process.cwd(), "schema", "surreal-schema.surql");

const cacheDir = process.env.EVAL_CACHE_DIR ?? "eval-results/cache";
const cachePath = join(cacheDir, "extraction-cache.json");
const resultCache = loadCache(cachePath);
const cases = JSON.parse(readFileSync(join(process.cwd(), "evals", "data", "golden-cases.json"), "utf8")) as GoldenCase[];
assertAutoevalEnv();

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

const factualityScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "factuality",
  description: "Average factual grounding score for extracted entity texts against matched provenance evidence snippets.",
  scorer: async ({ input, output }) => {
    if (output.extractedEntities.length === 0) {
      return { score: 1 };
    }

    let total = 0;
    for (const entity of output.extractedEntities) {
      const snippet = resolveEntityEvidenceSnippet(entity.text, output.evidenceRows, input.input);
      const result = await Factuality({
        input: snippet,
        output: entity.text,
        expected: snippet,
        model: autoevalModel,
      });
      total += result.score ?? 0;
    }

    return { score: total / output.extractedEntities.length };
  },
});

evalite<GoldenCase, ExtractionEvalOutput, GoldenCase>("Extraction Golden Cases", {
  data: cases.map((testCase) => ({ input: testCase, expected: testCase })),
  task: async (input) => runCase(input),
  scorers: [
    entityPrecisionScorer,
    entityRecallScorer,
    noPhantomPersonsScorer,
    evidenceGroundedScorer,
    noPlaceholdersScorer,
    factualityScorer,
  ],
  columns: ({ input, output, scores }) => [
    { label: "Model", value: extractionModel },
    { label: "Precision", value: formatScoreCell(scoreByName(scores, "entity-precision")) },
    { label: "Recall", value: formatScoreCell(scoreByName(scores, "entity-recall")) },
    { label: "NoPeople", value: formatScoreCell(scoreByName(scores, "no-phantom-persons")) },
    { label: "Evidence", value: formatScoreCell(scoreByName(scores, "evidence-grounded")) },
    { label: "NoPlace", value: formatScoreCell(scoreByName(scores, "no-placeholders")) },
    { label: "Factual", value: formatScoreCell(scoreByName(scores, "factuality")) },
    { label: "Case", value: input.id },
    { label: "Expected", value: input.expectedEntities.length },
    { label: "Extracted", value: output.extractedEntities.length },
    { label: "People", value: `${output.personCount}/${output.ownerPersonCount}` },
    {
      label: "Avg",
      value: (scores.reduce((acc, score) => acc + (score.score ?? 0), 0) / Math.max(scores.length, 1)).toFixed(2),
    },
  ],
});

function scoreByName(
  scores: Array<{ name: string; score: number | null }>,
  name: string,
): number | null {
  const match = scores.find((score) => score.name === name);
  return match?.score ?? null;
}

function formatScoreCell(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }

  return value.toFixed(2);
}

function resolveEntityEvidenceSnippet(
  entityText: string,
  evidenceRows: Array<{ evidence?: string; fromText?: string; model?: string }>,
  fallbackInput: string,
): string {
  const normalizedEntityText = normalizeForSubstring(entityText);
  const matched = evidenceRows.find((row) => normalizeForSubstring(row.fromText ?? "") === normalizedEntityText);
  const snippet = matched?.evidence ?? evidenceRows[0]?.evidence ?? fallbackInput;
  return snippet.trim().length > 0 ? snippet : fallbackInput;
}

async function runCase(testCase: GoldenCase): Promise<ExtractionEvalOutput> {
  const cacheKey = `${extractionModel}:${testCase.id}`;
  const cached = resultCache[cacheKey];
  if (cached) {
    return cached;
  }

  await ensureEvalEnvironment();

  const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Eval ${testCase.id} ${Date.now()}`,
      ownerDisplayName: "Marcus",
    }),
  });

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  let output: ExtractionEvalOutput | undefined;

  try {
    const db = await getSurreal();
    const ownerPersonCount = await loadWorkspacePeopleCount(db, workspaceRecord);

    const message = await fetchJson<{ streamUrl: string; userMessageId: string }>(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        workspaceId: workspace.workspaceId,
        conversationId: workspace.conversationId,
        text: testCase.input,
      }),
    });

    const events = await collectSseEvents(`${baseUrl}${message.streamUrl}`, 8_000);
    const extractionEvent = events.find((event) => event.type === "extraction") as
      | { type: "extraction"; entities: Array<{ kind: string; text: string; confidence: number }> }
      | undefined;

    const [evidenceRows] = await db
      .query<[Array<{ evidence?: string; from_text?: string; model?: string }>]>(
        "SELECT evidence, from_text, model FROM extraction_relation WHERE `in` = $source;",
        { source: new RecordId("message", message.userMessageId) },
      )
      .collect<[Array<{ evidence?: string; from_text?: string; model?: string }>]>();

    const personCount = await loadWorkspacePeopleCount(db, workspaceRecord);

    output = {
      caseId: testCase.id,
      input: testCase.input,
      extractedEntities: extractionEvent?.entities ?? [],
      personCount,
      ownerPersonCount,
      evidenceRows: evidenceRows.map((row) => ({
        evidence: row.evidence,
        fromText: row.from_text,
        model: row.model,
      })),
    };

    resultCache[cacheKey] = output;
    saveCache(cachePath, resultCache);
    return output;
  } finally {
    await cleanupWorkspace(workspace.workspaceId).catch(() => undefined);
  }
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

async function loadWorkspacePeopleCount(
  db: Surreal,
  workspace: RecordId<"workspace", string>,
): Promise<number> {
  const [people] = await db
    .query<[Array<{ id: RecordId<"person", string> }>]>(
      "SELECT id FROM person WHERE id IN (SELECT VALUE `in` FROM member_of WHERE out = $workspace);",
      { workspace },
    )
    .collect<[Array<{ id: RecordId<"person", string> }>]>() ;

  return people.length;
}

type StreamEvent =
  | { type: "extraction"; entities: Array<{ kind: string; text: string; confidence: number }> }
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

async function cleanupWorkspace(targetWorkspaceId: string): Promise<void> {
  const db = await getSurreal();
  const workspace = new RecordId("workspace", targetWorkspaceId);

  await db.query(
    [
      "DELETE extraction_relation WHERE `in` IN (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace));",
      "DELETE entity_relation WHERE source_message IN (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace));",
      "DELETE has_project WHERE `in` = $workspace;",
      "DELETE task WHERE source_message IN (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace));",
      "DELETE decision WHERE source_message IN (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace));",
      "DELETE question WHERE source_message IN (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace));",
      "DELETE message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace);",
      "DELETE conversation WHERE workspace = $workspace;",
      "DELETE member_of WHERE out = $workspace;",
      "DELETE $workspace;",
    ].join(" "),
    { workspace },
  );
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
      stdio: ["ignore", "pipe", "pipe"],
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

function loadCache(path: string): Record<string, ExtractionEvalOutput> {
  if (!existsSync(path)) {
    return {};
  }

  return JSON.parse(readFileSync(path, "utf8")) as Record<string, ExtractionEvalOutput>;
}

function saveCache(path: string, cache: Record<string, ExtractionEvalOutput>): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
}

function assertAutoevalEnv(): void {
  const hasOpenAiKey = hasEnv("OPENAI_API_KEY");
  const hasBraintrustKey = hasEnv("BRAINTRUST_API_KEY");
  if (!hasOpenAiKey && !hasBraintrustKey) {
    throw new Error(
      "Missing evaluator credentials. Set OPENAI_API_KEY (recommended for OPENAI_BASE_URL/OpenRouter) or BRAINTRUST_API_KEY.",
    );
  }

  if (!hasEnv("OPENAI_BASE_URL")) {
    throw new Error("Missing OPENAI_BASE_URL for autoevals provider routing.");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0;
}
