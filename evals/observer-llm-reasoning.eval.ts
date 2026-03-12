/**
 * Observer LLM Reasoning Eval
 *
 * Measures the quality of LLM-powered semantic verification in the observer pipeline.
 * Tests whether the LLM correctly identifies contradictions, matches, and ambiguous
 * relationships between decisions and tasks.
 *
 * Calls the real LLM — no mocking. Requires OBSERVER_MODEL in env.
 *
 * Scorers:
 *   verdict-accuracy     — Does the LLM verdict match the expected outcome?
 *   confidence-calibration — Is confidence well-calibrated for the scenario?
 *   reasoning-quality    — Does reasoning reference relevant entities?
 *   no-hallucination     — Does reasoning avoid forbidden patterns?
 *   factuality           — LLM judge: is reasoning factually consistent?
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { evalite } from "evalite";
import { Factuality } from "autoevals";
import { afterAll, beforeAll } from "vitest";
import { RecordId } from "surrealdb";
import {
  type EvalRuntime,
  setupEvalRuntime,
  teardownEvalRuntime,
} from "./eval-test-kit";
import { seedObserverLlmTestData, type ObserverLlmSeedResult } from "./observer-llm-reasoning-seed-data";
import { verdictAccuracyScorer } from "./scorers/verdict-accuracy";
import { confidenceCalibrationScorer } from "./scorers/confidence-calibration";
import { reasoningQualityScorer } from "./scorers/reasoning-quality";
import type { ObserverLlmTestCase, ObserverLlmEvalOutput } from "./types";
import { buildEntityContext } from "../app/src/server/observer/context-loader";
import { generateVerificationVerdict, generatePeerReviewVerdict } from "../app/src/server/observer/llm-reasoning";
import { detectContradictions, evaluateAnomalies, type AnomalyCandidate } from "../app/src/server/observer/llm-synthesis";
import { applyLlmVerdict } from "../app/src/server/observer/verification-pipeline";

const observerModelId = process.env.OBSERVER_MODEL;
if (!observerModelId) {
  throw new Error("OBSERVER_MODEL env var is required for observer LLM reasoning evals");
}

let runtime: EvalRuntime;
let seedResult: ObserverLlmSeedResult;
let observerModel: LanguageModel;

beforeAll(async () => {
  try {
    runtime = await setupEvalRuntime("observer-llm");
    seedResult = await seedObserverLlmTestData(runtime.surreal);

    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
    observerModel = openrouter(observerModelId, {
      plugins: [{ id: "response-healing" }],
    });
  } catch (error) {
    console.error("beforeAll setup failed:", error);
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await teardownEvalRuntime(runtime);
}, 120_000);

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const cases: ObserverLlmTestCase[] = [
  // --- Verification: Clear contradictions ---
  {
    id: "clear-contradiction-deps",
    evalType: "verification",
    scenario: "Task adds Redis+Kafka but decision says minimize external deps",
    seedCaseKey: "clear-contradiction",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "conflict",
    expectedReasoningAnchors: ["redis", "kafka", "external"],
    expectedFacts: "The task adds Redis and Kafka as new external service dependencies, which directly contradicts the decision to minimize external service dependencies.",
  },
  {
    id: "api-contradiction-trpc-vs-rest",
    evalType: "verification",
    scenario: "Task builds REST billing API but decision mandates tRPC",
    seedCaseKey: "api-contradiction",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "conflict",
    expectedReasoningAnchors: ["rest", "trpc"],
    expectedFacts: "The task implements a REST API with Express, which contradicts the decision to standardize on tRPC and forbid REST for new services.",
  },
  {
    id: "security-contradiction-sql",
    evalType: "verification",
    scenario: "Task uses SQL string concatenation but decision requires parameterized queries",
    seedCaseKey: "security-contradiction",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "conflict",
    expectedReasoningAnchors: ["parameterized", "concatenation"],
    expectedFacts: "The task builds SQL queries via string concatenation, which contradicts the decision requiring parameterized statements and forbidding string concatenation in SQL.",
  },
  {
    id: "format-contradiction-xml",
    evalType: "verification",
    scenario: "Task outputs XML but decision mandates JSON-only responses",
    seedCaseKey: "format-contradiction",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "conflict",
    expectedReasoningAnchors: ["xml", "json"],
    expectedFacts: "The task implements an XML export endpoint, which contradicts the decision that all API responses must use JSON format exclusively.",
  },

  // --- Verification: Clear match ---
  {
    id: "clear-match-typescript",
    evalType: "verification",
    scenario: "Task implements TypeScript middleware, decision requires TypeScript",
    seedCaseKey: "clear-match",
    expectedVerdict: "match",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "info",
    expectedReasoningAnchors: ["typescript"],
    expectedFacts: "The task implements authentication middleware in TypeScript, which aligns with the decision to use TypeScript for all backend services.",
  },

  // --- Verification: Ambiguous ---
  {
    id: "ambiguous-convention-vs-config",
    evalType: "verification",
    scenario: "Task adds config file, decision prefers convention over configuration",
    seedCaseKey: "ambiguous",
    expectedVerdict: "inconclusive",
    expectedConfidenceRange: [0.0, 0.7],
    expectedSeverity: "info",
    forbiddenReasoningPatterns: ["clearly contradicts", "severe violation"],
  },

  // --- Peer review: Grounded observation ---
  {
    id: "peer-review-grounded",
    evalType: "peer_review",
    scenario: "PM observation about blocked task with evidence edges — should be sound",
    seedCaseKey: "grounded-warning",
    expectedVerdict: "match",
    expectedConfidenceRange: [0.5, 1.0],
    expectedSeverity: "info",
    expectedReasoningAnchors: ["rate limiting", "in_progress", "provisional"],
    expectedFacts: "The PM observation correctly identifies that a rate limiting task has been in progress for an extended period with no linked commits, and the related decision about API quota enforcement is still provisional.",
  },

  // --- Peer review: Ungrounded claim ---
  {
    id: "peer-review-ungrounded",
    evalType: "peer_review",
    scenario: "PM observation makes sweeping claim with no evidence edges",
    seedCaseKey: "ungrounded-claim",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.0, 0.4],
    expectedSeverity: "warning",
    forbiddenReasoningPatterns: ["clearly correct", "well-supported"],
    expectedFacts: "The observation claims the entire authentication system is fundamentally broken, but no entities are linked as evidence. Without cited evidence, this sweeping claim is unsupported.",
  },

  // --- Contradiction detection: finds clear contradictions ---
  {
    id: "detect-contradictions-trpc-vs-rest",
    evalType: "contradiction_detection",
    scenario: "Workspace with tRPC decision and REST task — should detect contradiction",
    seedCaseKey: "detect-mixed",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "conflict",
    expectedContradictionCount: 1,
    expectedContradictionPairs: [{ decisionKey: "api-contradiction", taskKey: "api-contradiction" }],
    expectedFacts: "The LLM should detect that a REST billing API task contradicts a tRPC-only decision.",
  },

  // --- Contradiction detection: no false positives on matching pairs ---
  {
    id: "detect-contradictions-no-false-positive",
    evalType: "contradiction_detection",
    scenario: "Workspace with TypeScript decision and TypeScript task — should find zero contradictions",
    seedCaseKey: "detect-clean",
    expectedVerdict: "match",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "info",
    expectedContradictionCount: 0,
    expectedFacts: "The LLM should detect no contradictions when a TypeScript task aligns with a TypeScript-only decision.",
  },

  // --- Contradiction detection: multiple contradictions in one scan ---
  {
    id: "detect-contradictions-multiple",
    evalType: "contradiction_detection",
    scenario: "Multiple decisions with conflicting tasks — should detect all contradictions",
    seedCaseKey: "detect-multi",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.6, 1.0],
    expectedSeverity: "conflict",
    expectedContradictionCount: 2,
    expectedContradictionPairs: [
      { decisionKey: "api-contradiction", taskKey: "api-contradiction" },
      { decisionKey: "security-contradiction", taskKey: "security-contradiction" },
    ],
    expectedFacts: "The LLM should detect both the REST-vs-tRPC contradiction and the string-concat-vs-parameterized-queries contradiction.",
  },

  // --- Anomaly evaluation: genuinely stuck task ---
  {
    id: "anomaly-eval-genuinely-stuck",
    evalType: "anomaly_evaluation",
    scenario: "Task blocked 30 days with no clear external reason — should be marked relevant",
    seedCaseKey: "anomaly-stuck",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.5, 1.0],
    expectedSeverity: "warning",
    expectedRelevant: true,
    expectedReasoningAnchors: ["refactor", "blocked"],
    expectedFacts: "The task has been blocked for 30 days with no clear external dependency or vendor wait. It appears genuinely forgotten or stalled.",
  },

  // --- Anomaly evaluation: expected external wait ---
  {
    id: "anomaly-eval-external-wait",
    evalType: "anomaly_evaluation",
    scenario: "Task blocked awaiting external vendor — should be marked not relevant",
    seedCaseKey: "anomaly-external",
    expectedVerdict: "match",
    expectedConfidenceRange: [0.5, 1.0],
    expectedSeverity: "info",
    expectedRelevant: false,
    expectedReasoningAnchors: ["vendor", "external"],
    expectedFacts: "The task is waiting on an external vendor for SOC2 compliance review. This is an expected external dependency, not a forgotten task.",
  },

  // --- Anomaly evaluation: critical status drift ---
  {
    id: "anomaly-eval-critical-drift",
    evalType: "anomaly_evaluation",
    scenario: "Task completed before its prerequisite database schema — should be relevant",
    seedCaseKey: "anomaly-drift-critical",
    expectedVerdict: "mismatch",
    expectedConfidenceRange: [0.5, 1.0],
    expectedSeverity: "warning",
    expectedRelevant: true,
    expectedReasoningAnchors: ["schema", "depend"],
    expectedFacts: "The CRUD operations task was completed before the database schema design, which is a prerequisite. This could mean the implementation is based on an unfinished or missing schema.",
  },

  // --- Anomaly evaluation: optional dependency drift ---
  {
    id: "anomaly-eval-optional-drift",
    evalType: "anomaly_evaluation",
    scenario: "Task completed before documentation dependency — may be filtered as not relevant",
    seedCaseKey: "anomaly-drift-optional",
    expectedVerdict: "match",
    expectedConfidenceRange: [0.3, 1.0],
    expectedSeverity: "info",
    expectedRelevant: false,
    expectedReasoningAnchors: ["documentation"],
    expectedFacts: "The API was shipped before documentation was written. Documentation is typically not a hard prerequisite — it can be written after shipping.",
  },
];

// ---------------------------------------------------------------------------
// Task runner
// ---------------------------------------------------------------------------

async function runObserverLlmCase(testCase: ObserverLlmTestCase): Promise<ObserverLlmEvalOutput> {
  try {
    if (testCase.evalType === "verification") {
      return await runVerificationCase(testCase);
    }
    if (testCase.evalType === "contradiction_detection") {
      return await runContradictionDetectionCase(testCase);
    }
    if (testCase.evalType === "anomaly_evaluation") {
      return await runAnomalyEvaluationCase(testCase);
    }
    return await runPeerReviewCase(testCase);
  } catch (error) {
    return {
      caseId: testCase.id,
      verdict: "",
      reasoning: "",
      severity: "",
      evidenceRefs: [],
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runVerificationCase(testCase: ObserverLlmTestCase): Promise<ObserverLlmEvalOutput> {
  const taskRecord = seedResult.tasks.get(testCase.seedCaseKey);
  if (!taskRecord) {
    throw new Error(`No seeded task for case key: ${testCase.seedCaseKey}`);
  }

  const taskId = taskRecord.id as string;

  // Build entity context (loads related decisions from graph)
  const context = await buildEntityContext(
    runtime.surreal,
    seedResult.workspaceRecord,
    "task",
    taskId,
  );

  // Provide a minimal deterministic result for the LLM to enhance
  const deterministicResult = {
    verdict: "inconclusive" as const,
    severity: "info" as const,
    verified: false,
    text: "Deterministic check: no external signals available.",
  };

  const llmVerdict = await generateVerificationVerdict(observerModel, context, deterministicResult);
  const finalVerdict = applyLlmVerdict(deterministicResult, llmVerdict);

  return {
    caseId: testCase.id,
    verdict: finalVerdict.verdict,
    confidence: finalVerdict.confidence,
    reasoning: finalVerdict.text,
    severity: finalVerdict.severity,
    evidenceRefs: finalVerdict.evidenceRefs ?? [],
    success: true,
  };
}

async function runPeerReviewCase(testCase: ObserverLlmTestCase): Promise<ObserverLlmEvalOutput> {
  const obsRecord = seedResult.observations.get(testCase.seedCaseKey);
  if (!obsRecord) {
    throw new Error(`No seeded observation for case key: ${testCase.seedCaseKey}`);
  }

  const obsId = obsRecord.id as string;

  // Load the observation details
  const [obsRows] = await runtime.surreal.query<[Array<{
    text: string;
    severity: string;
    source_agent: string;
  }>]>(
    `SELECT text, severity, source_agent FROM $obs;`,
    { obs: new RecordId("observation", obsId) },
  );
  const obs = obsRows?.[0];
  if (!obs) throw new Error(`Observation not found: ${obsId}`);

  // Load linked entities via observes edges
  const [edgeRows] = await runtime.surreal.query<[Array<{ out: RecordId }>]>(
    `SELECT out FROM observes WHERE in = $obs;`,
    { obs: new RecordId("observation", obsId) },
  );

  const linkedEntities: Array<{ table: string; id: string; title: string; description?: string }> = [];
  for (const row of edgeRows ?? []) {
    const targetTable = row.out.table.name;
    const targetId = row.out.id as string;
    const [details] = await runtime.surreal.query<[Array<{
      title?: string; summary?: string; text?: string; description?: string;
    }>]>(
      `SELECT title, summary, text, description FROM $record;`,
      { record: new RecordId(targetTable, targetId) },
    );
    const d = details?.[0];
    linkedEntities.push({
      table: targetTable,
      id: targetId,
      title: d?.title ?? d?.summary ?? d?.text ?? "Unknown",
      description: d?.description,
    });
  }

  const llmVerdict = await generatePeerReviewVerdict(
    observerModel,
    obs.text,
    obs.severity,
    obs.source_agent,
    linkedEntities,
  );

  if (!llmVerdict) {
    return {
      caseId: testCase.id,
      verdict: "inconclusive",
      reasoning: "LLM peer review failed",
      severity: "info",
      evidenceRefs: [],
      success: false,
      error: "LLM returned undefined",
    };
  }

  return {
    caseId: testCase.id,
    verdict: llmVerdict.verdict === "sound" ? "match" : llmVerdict.verdict === "unsupported" ? "mismatch" : "inconclusive",
    confidence: llmVerdict.confidence,
    reasoning: llmVerdict.reasoning,
    severity: llmVerdict.verdict === "unsupported" ? "warning" : "info",
    evidenceRefs: [],
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Contradiction detection case subsets (keyed by seedCaseKey)
// ---------------------------------------------------------------------------

const CONTRADICTION_DETECTION_SUBSETS: Record<string, {
  decisionKeys: string[];
  taskKeys: string[];
}> = {
  "detect-mixed": {
    decisionKeys: ["api-contradiction"],
    taskKeys: ["api-contradiction", "clear-match"],
  },
  "detect-clean": {
    decisionKeys: ["clear-match"],
    taskKeys: ["clear-match"],
  },
  "detect-multi": {
    decisionKeys: ["api-contradiction", "security-contradiction", "clear-match"],
    taskKeys: ["api-contradiction", "security-contradiction", "clear-match"],
  },
};

async function runContradictionDetectionCase(testCase: ObserverLlmTestCase): Promise<ObserverLlmEvalOutput> {
  const subset = CONTRADICTION_DETECTION_SUBSETS[testCase.seedCaseKey];
  if (!subset) {
    throw new Error(`No contradiction detection subset for case key: ${testCase.seedCaseKey}`);
  }

  const decisions = subset.decisionKeys.map((key) => {
    const record = seedResult.decisions.get(key);
    if (!record) throw new Error(`No seeded decision for key: ${key}`);
    return record;
  });

  const tasks = subset.taskKeys.map((key) => {
    const record = seedResult.tasks.get(key);
    if (!record) throw new Error(`No seeded task for key: ${key}`);
    return record;
  });

  // Load decision summaries and task titles from DB
  const decisionInputs = await Promise.all(decisions.map(async (decRecord) => {
    const [rows] = await runtime.surreal.query<[Array<{ summary: string; rationale?: string }>]>(
      `SELECT summary, rationale FROM $record;`,
      { record: decRecord },
    );
    return { id: decRecord.id as string, summary: rows[0].summary, rationale: rows[0].rationale };
  }));

  const taskInputs = await Promise.all(tasks.map(async (taskRecord) => {
    const [rows] = await runtime.surreal.query<[Array<{ title: string; description?: string }>]>(
      `SELECT title, description FROM $record;`,
      { record: taskRecord },
    );
    return { id: taskRecord.id as string, title: rows[0].title, description: rows[0].description };
  }));

  const detected = await detectContradictions(observerModel, decisionInputs, taskInputs);

  if (!detected) {
    return {
      caseId: testCase.id,
      verdict: "inconclusive",
      reasoning: "LLM contradiction detection failed (returned undefined)",
      severity: "info",
      evidenceRefs: [],
      success: false,
      error: "LLM returned undefined",
    };
  }

  const contradictionCount = detected.length;
  const expectedCount = testCase.expectedContradictionCount ?? 0;
  const countMatches = contradictionCount === expectedCount;

  // Check if expected pairs were found
  let pairsMatch = true;
  if (testCase.expectedContradictionPairs) {
    for (const expected of testCase.expectedContradictionPairs) {
      const expectedDecId = seedResult.decisions.get(expected.decisionKey)?.id as string;
      const expectedTaskId = seedResult.tasks.get(expected.taskKey)?.id as string;
      const found = detected.some((c) =>
        c.decision_ref.includes(expectedDecId) && c.task_ref.includes(expectedTaskId),
      );
      if (!found) pairsMatch = false;
    }
  }

  const reasoning = detected.map((c) => c.reasoning).join("; ") || "No contradictions found";

  return {
    caseId: testCase.id,
    verdict: countMatches && pairsMatch
      ? (contradictionCount > 0 ? "mismatch" : "match")
      : "inconclusive",
    confidence: countMatches && pairsMatch ? 0.9 : 0.3,
    reasoning,
    severity: contradictionCount > 0 ? "conflict" : "info",
    evidenceRefs: detected.flatMap((c) => [c.decision_ref, c.task_ref]),
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Anomaly evaluation cases (keyed by seedCaseKey)
// ---------------------------------------------------------------------------

const ANOMALY_EVAL_CANDIDATES: Record<string, AnomalyCandidate[]> = {
  "anomaly-stuck": [
    {
      entityRef: "task:stuck-refactor",
      type: "stale_blocked",
      title: "Refactor authentication module",
      description: "Needs refactoring but nobody has picked it up",
      detail: "Blocked for 30 days since 2026-02-11",
    },
  ],
  "anomaly-external": [
    {
      entityRef: "task:external-soc2",
      type: "stale_blocked",
      title: "Waiting on legal team to complete SOC2 compliance review",
      description: "Blocked until legal provides signed compliance attestation from external auditor. Expected timeline: 4-6 weeks from submission date.",
      detail: "Blocked for 20 days since 2026-02-21",
    },
  ],
  "anomaly-drift-critical": [
    {
      entityRef: "task:crud-before-schema",
      type: "status_drift",
      title: "Implement user profile CRUD operations",
      description: "Build CRUD endpoints for user profile management",
      detail: 'Marked as completed but dependency "Design database schema for user profiles" is still in_progress',
    },
  ],
  "anomaly-drift-optional": [
    {
      entityRef: "task:ship-before-docs",
      type: "status_drift",
      title: "Ship API endpoint to production",
      description: "Deploy the new API endpoint for customer-facing feature",
      detail: 'Marked as completed but dependency "Write documentation for API endpoints" is still in_progress',
    },
  ],
};

async function runAnomalyEvaluationCase(testCase: ObserverLlmTestCase): Promise<ObserverLlmEvalOutput> {
  const candidates = ANOMALY_EVAL_CANDIDATES[testCase.seedCaseKey];
  if (!candidates) {
    throw new Error(`No anomaly eval candidates for case key: ${testCase.seedCaseKey}`);
  }

  const evaluations = await evaluateAnomalies(observerModel, candidates);

  if (!evaluations || evaluations.length === 0) {
    return {
      caseId: testCase.id,
      verdict: "inconclusive",
      reasoning: "LLM anomaly evaluation failed (returned undefined or empty)",
      severity: "info",
      evidenceRefs: [],
      success: false,
      error: "LLM returned undefined",
    };
  }

  const evaluation = evaluations[0];
  const expectedRelevant = testCase.expectedRelevant ?? true;
  const relevantMatches = evaluation.relevant === expectedRelevant;

  return {
    caseId: testCase.id,
    verdict: relevantMatches
      ? (evaluation.relevant ? "mismatch" : "match")
      : "inconclusive",
    confidence: relevantMatches ? 0.9 : 0.3,
    reasoning: evaluation.reasoning,
    severity: evaluation.suggested_severity,
    evidenceRefs: [evaluation.entity_ref],
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Eval definition
// ---------------------------------------------------------------------------

evalite<ObserverLlmTestCase, ObserverLlmEvalOutput, ObserverLlmTestCase>(
  "Observer LLM Reasoning Quality",
  {
    data: cases.map((testCase) => ({ input: testCase, expected: testCase })),
    task: async (input) => runObserverLlmCase(input),
    scorers: [
      {
        name: "verdict-accuracy",
        description: "Does the LLM verdict match the expected outcome (match/mismatch/inconclusive)?",
        scorer: verdictAccuracyScorer,
      },
      {
        name: "confidence-calibration",
        description: "Is the confidence score appropriate for the scenario clarity?",
        scorer: confidenceCalibrationScorer,
      },
      {
        name: "reasoning-quality",
        description: "Does the reasoning text reference relevant entities and decisions?",
        scorer: reasoningQualityScorer,
      },
      {
        name: "no-hallucination",
        description: "Reasoning does not contain forbidden patterns",
        scorer: ({ output, expected }) => {
          if (!expected?.forbiddenReasoningPatterns || expected.forbiddenReasoningPatterns.length === 0) return 1;
          if (!output.reasoning) return 1;
          const lowerReasoning = output.reasoning.toLowerCase();
          const violations = expected.forbiddenReasoningPatterns.filter((p) =>
            lowerReasoning.includes(p.toLowerCase()),
          );
          return violations.length === 0 ? 1 : 0;
        },
      },
      {
        name: "factuality",
        description: "LLM judge: is reasoning factually consistent with ground truth?",
        scorer: async ({ output, expected }) => {
          if (!expected?.expectedFacts || !output.success) return 1;
          const result = await Factuality({
            input: expected.scenario,
            output: output.reasoning,
            expected: expected.expectedFacts,
          });
          const score = result.score ?? 0;
          return score >= 0.4 ? 1 : 0;
        },
      },
    ],
    columns: ({ input, output, scores }) => [
      { label: "Model", value: observerModelId },
      { label: "Case", value: input.id },
      { label: "Type", value: input.evalType },
      { label: "Success", value: output.success ? "yes" : "no" },
      { label: "Verdict", value: formatScore(scores, "verdict-accuracy") },
      { label: "Confid", value: formatScore(scores, "confidence-calibration") },
      { label: "Reason", value: formatScore(scores, "reasoning-quality") },
      { label: "NoHalluc", value: formatScore(scores, "no-hallucination") },
      { label: "Factual", value: formatScore(scores, "factuality") },
    ],
  },
);

function formatScore(scores: Array<{ name: string; score: number | null }>, name: string): string {
  const match = scores.find((s) => s.name === name);
  return match?.score !== null && match?.score !== undefined ? match.score.toFixed(2) : "N/A";
}
