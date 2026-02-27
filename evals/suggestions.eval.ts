import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { evalite } from "evalite";
import { afterAll, beforeAll } from "vitest";
import { suggestionGroundingScorer } from "./scorers/suggestion-grounding";
import { noGenericSuggestionsScorer } from "./scorers/no-generic-suggestions";
import { suggestionCountScorer } from "./scorers/suggestion-count";
import type { SuggestionGoldenCase, SuggestionsEvalOutput } from "./types";
import { processChatMessage } from "../app/src/server/chat/chat-processor";
import type { ServerDependencies } from "../app/src/server/runtime/types";
import {
  type EvalRuntime,
  setupEvalRuntime,
  teardownEvalRuntime,
  seedWorkspace,
  seedUserMessage,
  createEventCollector,
} from "./eval-test-kit";

const assistantModel = process.env.ASSISTANT_MODEL ?? "unknown";

const cacheDir = process.env.EVAL_CACHE_DIR ?? "eval-results/cache";
const cachePath = join(cacheDir, "suggestions-cache.json");
const resultCache = loadCache(cachePath);
const cases = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "data", "suggestion-cases.json"), "utf8"),
) as SuggestionGoldenCase[];

let runtime: EvalRuntime;

beforeAll(async () => {
  runtime = await setupEvalRuntime("suggestions");
}, 120_000);

afterAll(async () => {
  await teardownEvalRuntime(runtime);
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

  const { workspaceRecord, conversationRecord } = await seedWorkspace(runtime.surreal);
  const userMessageRecord = await seedUserMessage(runtime.surreal, conversationRecord, testCase.input);
  const messageId = randomUUID();

  await runtime.surreal.query(
    "UPDATE $workspace SET onboarding_turn_count += 1, updated_at = $now;",
    { workspace: workspaceRecord, now: new Date() },
  );

  const sseStub = createEventCollector();
  sseStub.registerMessage(messageId);

  const deps: ServerDependencies = {
    config: runtime.config,
    surreal: runtime.surreal,
    assistantModel: runtime.assistantModel,
    extractionModel: runtime.extractionModel,
    embeddingModel: runtime.embeddingModel,
    sse: sseStub,
  };

  await processChatMessage({
    deps,
    conversationId: conversationRecord.id as string,
    messageId,
    workspaceRecord,
    userMessageRecord,
    userText: testCase.input,
  });

  const events = sseStub.getEvents(messageId);
  const assistantEvent = events.find((e) => e.type === "assistant_message") as
    | { type: "assistant_message"; text: string; suggestions?: string[] }
    | undefined;

  if (!assistantEvent) {
    const errorEvent = events.find((e) => e.type === "error") as
      | { type: "error"; error: string }
      | undefined;
    throw new Error(
      `No assistant_message event for case ${testCase.id}; ` +
      `events: ${events.map((e) => e.type).join(", ")}` +
      (errorEvent ? `; error: ${errorEvent.error}` : ""),
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
