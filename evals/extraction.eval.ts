import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { evalite, createScorer } from "evalite";
import { Factuality } from "autoevals";
import { afterAll, beforeAll } from "vitest";
import { RecordId } from "surrealdb";
import { entityPrecisionScorer } from "./scorers/entity-precision";
import { entityRecallScorer } from "./scorers/entity-recall";
import { noPhantomPersonsScorer } from "./scorers/no-phantom-persons";
import { evidenceGroundedScorer } from "./scorers/evidence-grounded";
import { noExtraEntitiesScorer } from "./scorers/no-extra-entities";
import { noContextBleedScorer } from "./scorers/no-context-bleed";
import { evidenceSourceCurrentMessageScorer } from "./scorers/evidence-source-current-message";
import { resolvedFromLineageScorer } from "./scorers/resolved-from-lineage";
import { toolFilteringScorer } from "./scorers/tool-filtering";
import { forbiddenKindsScorer } from "./scorers/forbidden-kinds";
import { relationRecallScorer } from "./scorers/relation-recall";
import { categoryAccuracyScorer } from "./scorers/category-accuracy";
import { priorityAccuracyScorer } from "./scorers/priority-accuracy";
import type { ExtractionEvalOutput, GoldenCase, GoldenCaseIntent } from "./types";
import { normalizeForSubstring } from "./scorers/shared";
import { extractStructuredGraph } from "../app/src/server/extraction/extract-graph";
import { persistExtractionOutput, appendExtractedTools } from "../app/src/server/extraction/persist-extraction";
import { loadExtractionConversationContext, loadConversationGraphContext } from "../app/src/server/extraction/context-loaders";
import type { SourceRecord } from "../app/src/server/extraction/types";
import { loadWorkspaceProjects } from "../app/src/server/workspace/workspace-scope";
import {
  type EvalRuntime,
  setupEvalRuntime,
  teardownEvalRuntime,
  seedWorkspace,
  seedConversationContext,
  seedUserMessage,
  seedGraphEntities,
  loadWorkspacePeopleCount,
  createDeterministicIdGenerator,
} from "./eval-test-kit";

const extractionModel = requireEnv("EXTRACTION_MODEL");
const autoevalModel = requireEnv("AUTOEVAL_MODEL");

const cacheDir = process.env.EVAL_CACHE_DIR ?? "eval-results/cache";
const cachePath = join(cacheDir, "extraction-cache.json");
const resultCache = loadCache(cachePath);
const cases = JSON.parse(readFileSync(join(process.cwd(), "evals", "data", "golden-cases.json"), "utf8")) as GoldenCase[];
assertAutoevalEnv();

// strict_single is reserved for unambiguous one-entity probes.
// Cases where multiple extractions are semantically valid should use multi_allowed.
const intentScoreWeights: Record<
  GoldenCaseIntent,
  Record<
    | "entity-precision"
    | "entity-recall"
    | "no-extra-entities"
    | "no-phantom-persons"
    | "evidence-grounded"
    | "no-context-bleed"
    | "evidence-source-current-message"
    | "resolved-from-lineage"
    | "tool-filtering"
    | "forbidden-kinds"
    | "factuality"
    | "relation-recall"
    | "category-accuracy"
    | "priority-accuracy",
    number
  >
> = {
  strict_single: {
    "entity-precision": 0.14,
    "entity-recall": 0.14,
    "no-extra-entities": 0.16,
    "no-phantom-persons": 0.11,
    "evidence-grounded": 0.08,
    "no-context-bleed": 0.05,
    "evidence-source-current-message": 0.05,
    "resolved-from-lineage": 0.04,
    "tool-filtering": 0.06,
    "forbidden-kinds": 0.07,
    factuality: 0.02,
    "relation-recall": 0,
    "category-accuracy": 0.08,
    "priority-accuracy": 0.08,
  },
  multi_allowed: {
    "entity-precision": 0.19,
    "entity-recall": 0.19,
    "no-extra-entities": 0.05,
    "no-phantom-persons": 0.10,
    "evidence-grounded": 0.07,
    "no-context-bleed": 0.04,
    "evidence-source-current-message": 0.05,
    "resolved-from-lineage": 0.04,
    "tool-filtering": 0.04,
    "forbidden-kinds": 0.05,
    factuality: 0.02,
    "relation-recall": 0.03,
    "category-accuracy": 0.08,
    "priority-accuracy": 0.08,
  },
};

let runtime: EvalRuntime;

beforeAll(async () => {
  runtime = await setupEvalRuntime("extraction");
}, 120_000);

afterAll(async () => {
  await teardownEvalRuntime(runtime);
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
    noExtraEntitiesScorer,
    noPhantomPersonsScorer,
    evidenceGroundedScorer,
    noContextBleedScorer,
    evidenceSourceCurrentMessageScorer,
    resolvedFromLineageScorer,
    toolFilteringScorer,
    forbiddenKindsScorer,
    relationRecallScorer,
    categoryAccuracyScorer,
    priorityAccuracyScorer,
    factualityScorer,
  ],
  columns: ({ input, output, scores }) => [
    { label: "Case", value: input.id },
    { label: "Intent", value: input.intent },
    { label: "Ent", value: `${output.extractedEntities.length}/${input.expectedEntities.length}` },
    { label: "Prec", value: formatScoreCell(scoreByName(scores, "entity-precision")) },
    { label: "Rec", value: formatScoreCell(scoreByName(scores, "entity-recall")) },
    { label: "Cat", value: formatScoreCell(scoreByName(scores, "category-accuracy")) },
    { label: "Pri", value: formatScoreCell(scoreByName(scores, "priority-accuracy")) },
    {
      label: "Avg",
      value: computeWeightedAverage(input.intent, scores).toFixed(2),
    },
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

function computeWeightedAverage(
  intent: GoldenCaseIntent,
  scores: Array<{ name: string; score: number | null }>,
): number {
  const weights = intentScoreWeights[intent];
  if (!weights) {
    throw new Error(`Unknown golden case intent: ${intent}`);
  }

  let weightedTotal = 0;
  let weightTotal = 0;
  for (const [scorerName, weight] of Object.entries(weights)) {
    if (weight <= 0) {
      continue;
    }

    weightedTotal += scoreByName(scores, scorerName) * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) {
    throw new Error(`No scorer weights configured for intent: ${intent}`);
  }

  return weightedTotal / weightTotal;
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
  const cacheKey = buildCaseCacheKey(extractionModel, testCase);
  const cached = resultCache[cacheKey];
  if (cached) {
    return {
      ...cached,
      extractedTools: cached.extractedTools ?? [],
      extractedRelations: cached.extractedRelations ?? [],
    };
  }

  const nextId = createDeterministicIdGenerator(testCase.id);
  const { workspaceRecord, workspaceName, projectRecord, conversationRecord, ownerPersonCount } = await seedWorkspace(runtime.surreal, testCase.workspace_name, nextId);
  const conversationId = conversationRecord.id as string;
  const seededContext = testCase.context ?? [];
  const contextMessageIds = seededContext.length > 0
    ? await seedConversationContext(runtime.surreal, conversationRecord, seededContext, nextId)
    : [];

  if (testCase.workspace_seed && testCase.workspace_seed.length > 0) {
    await seedGraphEntities(runtime.surreal, workspaceRecord, projectRecord, conversationRecord, testCase.workspace_seed, nextId);
  }

  const userMessageRecord = await seedUserMessage(runtime.surreal, conversationRecord, testCase.input, nextId);

  const extractionConversationContext = await loadExtractionConversationContext({
    surreal: runtime.surreal,
    conversationId,
    currentMessageRecord: userMessageRecord,
  });
  const extractionGraphContext = await loadConversationGraphContext(runtime.surreal, conversationId, 60);
  const workspaceProjects = await loadWorkspaceProjects(runtime.surreal, workspaceRecord);
  const workspaceProjectNames = workspaceProjects.map((project) => project.name);

  const extraction = await extractStructuredGraph({
    extractionModel: runtime.extractionModel,
    conversationHistory: extractionConversationContext.conversationHistory,
    currentMessage: extractionConversationContext.currentMessage,
    graphContext: extractionGraphContext,
    sourceText: testCase.input,
    onboarding: true,
    workspaceName,
    projectNames: workspaceProjectNames,
  });

  const now = new Date();
  const persistence = await persistExtractionOutput({
    surreal: runtime.surreal,
    extractionModel: runtime.extractionModel,
    embeddingModel: runtime.embeddingModel,
    embeddingDimension: runtime.config.embeddingDimension,
    extractionModelId: runtime.config.extractionModelId,
    extractionStoreThreshold: runtime.config.extractionStoreThreshold,
    workspaceRecord,
    sourceRecord: userMessageRecord as SourceRecord,
    sourceKind: "message",
    sourceLabel: testCase.input.slice(0, 140),
    promptText: testCase.input,
    output: extraction,
    sourceMessageRecord: userMessageRecord,
    extractionHistoryMessageIds: extractionConversationContext.conversationHistory.map(
      (row) => row.id.id as string,
    ),
    now,
  });

  await appendExtractedTools(runtime.surreal, workspaceRecord, persistence.tools, now);

  const [evidenceRows] = await runtime.surreal
    .query<[Array<{
      evidence?: string;
      from_text?: string;
      model?: string;
      evidence_source?: RecordId<"message", string>;
      resolved_from?: RecordId<"message", string>;
    }>]>(
      "SELECT evidence, from_text, model, evidence_source, resolved_from FROM extraction_relation WHERE `in` = $source;",
      { source: userMessageRecord },
    )
    .collect<[Array<{
      evidence?: string;
      from_text?: string;
      model?: string;
      evidence_source?: RecordId<"message", string>;
      resolved_from?: RecordId<"message", string>;
    }>]>();

  const personCount = await loadWorkspacePeopleCount(runtime.surreal, workspaceRecord);
  const [workspaceToolRows] = await runtime.surreal
    .query<[Array<{ tools?: string[] }>]>("SELECT tools FROM $workspace LIMIT 1;", {
      workspace: workspaceRecord,
    })
    .collect<[Array<{ tools?: string[] }>]>();
  const extractedTools = workspaceToolRows[0]?.tools ?? [];

  const [relationRows] = await runtime.surreal
    .query<[Array<{
      kind: string;
      in: { tb: string };
      out: { tb: string };
      from_text: string;
      to_text: string;
      confidence: number;
    }>]>(
      "SELECT kind, `in`, out, from_text, to_text, confidence FROM entity_relation WHERE source_message = $source AND kind != 'POSSIBLE_DUPLICATE';",
      { source: userMessageRecord },
    )
    .collect<[Array<{
      kind: string;
      in: { tb: string };
      out: { tb: string };
      from_text: string;
      to_text: string;
      confidence: number;
    }>]>();

  const output: ExtractionEvalOutput = {
    caseId: testCase.id,
    input: testCase.input,
    userMessageId: userMessageRecord.id as string,
    contextMessageIds,
    extractedEntities: persistence.entities.map((e) => ({
      kind: e.kind,
      text: e.text,
      confidence: e.confidence,
      ...(e.category ? { category: e.category } : {}),
      ...(e.priority ? { priority: e.priority } : {}),
    })),
    extractedTools,
    personCount,
    ownerPersonCount,
    evidenceRows: evidenceRows.map((row) => ({
      evidence: row.evidence,
      fromText: row.from_text,
      model: row.model,
      evidenceSourceId: row.evidence_source?.id as string | undefined,
      resolvedFromId: row.resolved_from?.id as string | undefined,
    })),
    extractedRelations: relationRows.map((row) => ({
      kind: row.kind,
      fromKind: row.in.tb,
      fromText: row.from_text,
      toKind: row.out.tb,
      toText: row.to_text,
      confidence: row.confidence,
    })),
  };

  resultCache[cacheKey] = output;
  saveCache(cachePath, resultCache);
  return output;
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

function buildCaseCacheKey(modelId: string, testCase: GoldenCase): string {
  const cacheVersion = "classification-v17";
  const caseHash = createHash("sha256").update(JSON.stringify(testCase)).digest("hex").slice(0, 24);
  return `${cacheVersion}:${modelId}:${testCase.id}:${caseHash}`;
}
