import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { evalite, createScorer } from "evalite";
import { Factuality } from "autoevals";
import { RecordId, Surreal } from "surrealdb";
import { entityPrecisionScorer } from "./scorers/entity-precision";
import { entityRecallScorer } from "./scorers/entity-recall";
import { noPhantomPersonsScorer } from "./scorers/no-phantom-persons";
import { evidenceGroundedScorer } from "./scorers/evidence-grounded";
import { noPlaceholdersScorer } from "./scorers/no-placeholders";
import type { ExtractionEvalOutput, GoldenCase } from "./types";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";
const surrealNamespace = process.env.SURREAL_NAMESPACE ?? "brain";
const surrealDatabase = process.env.SURREAL_DATABASE ?? "app";
const extractionModel = process.env.EXTRACTION_MODEL ?? "anthropic/claude-3.5-haiku";

const cacheDir = process.env.EVAL_CACHE_DIR ?? "eval-results/cache";
const cachePath = join(cacheDir, "extraction-cache.json");
const resultCache = loadCache(cachePath);
const cases = JSON.parse(readFileSync(join(process.cwd(), "evals", "data", "golden-cases.json"), "utf8")) as GoldenCase[];

let surreal: Surreal | undefined;

const factualityScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "factuality",
  description: "Average factual grounding score for extracted entity texts against source input.",
  scorer: async ({ input, output }) => {
    if (output.extractedEntities.length === 0) {
      return { score: 1 };
    }

    let total = 0;
    for (const entity of output.extractedEntities) {
      try {
        const result = await Factuality({
          input: input.input,
          output: entity.text,
          expected: input.input,
          model: process.env.AUTOEVAL_MODEL,
        });
        total += result.score ?? 0;
      } catch {
        total += 0;
      }
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
    { label: "Case", value: input.id },
    { label: "Extracted", value: output.extractedEntities.length },
    { label: "People", value: `${output.personCount}/${output.ownerPersonCount}` },
    {
      label: "Avg",
      value: (scores.reduce((acc, score) => acc + (score.score ?? 0), 0) / Math.max(scores.length, 1)).toFixed(2),
    },
  ],
});

async function runCase(testCase: GoldenCase): Promise<ExtractionEvalOutput> {
  const cacheKey = `${extractionModel}:${testCase.id}`;
  const cached = resultCache[cacheKey];
  if (cached) {
    return cached;
  }

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
      .query<[Array<{ evidence?: string }>]>(
        "SELECT evidence FROM extraction_relation WHERE `in` = $source;",
        { source: new RecordId("message", message.userMessageId) },
      )
      .collect<[Array<{ evidence?: string }>]>();

    const personCount = await loadWorkspacePeopleCount(db, workspaceRecord);

    output = {
      caseId: testCase.id,
      input: testCase.input,
      extractedEntities: extractionEvent?.entities ?? [],
      personCount,
      ownerPersonCount,
      evidenceRows,
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
  await surreal.use({ namespace: surrealNamespace, database: surrealDatabase });
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
