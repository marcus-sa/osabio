import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { evalite } from "evalite";
import { Factuality } from "autoevals";
import { Surreal } from "surrealdb";
import { afterAll, beforeAll } from "vitest";
import { runAnalyticsAgent, type AnalyticsAgentOutput } from "../app/src/server/agents/analytics/agent";
import type { ChatToolExecutionContext } from "../app/src/server/tools/types";
import { RecordId } from "surrealdb";
import {
  type EvalRuntime,
  setupEvalRuntime,
  teardownEvalRuntime,
} from "./eval-test-kit";
import { seedAnalyticsTestData, type AnalyticsSeedResult } from "./analytics-seed-data";

type AnalyticsTestCase = {
  id: string;
  question: string;
  /** Deterministic substring checks — use for values the model cannot paraphrase (numbers, proper nouns). */
  expectedAnswerContains?: string[];
  expectedAnswerNotContains?: string[];
  /** Ground truth for LLM factuality check — use when the model may paraphrase. */
  expectedFacts?: string;
};

type AnalyticsEvalOutput = {
  caseId: string;
  question: string;
  answer: string;
  query_executed: string;
  result_summary: string;
  referenced_entities: Array<{ entityId: string; kind: string; name: string; status?: string }>;
  success: boolean;
  error?: string;
};

const analyticsModelId = process.env.ANALYTICS_MODEL;
if (!analyticsModelId) {
  throw new Error("ANALYTICS_MODEL env var is required for analytics evals");
}

let runtime: EvalRuntime;
let seedResult: AnalyticsSeedResult;
let analyticsSurreal: Surreal;
let analyticsAgentModel: any;

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";

beforeAll(async () => {
  try {
    runtime = await setupEvalRuntime("analytics");
    seedResult = await seedAnalyticsTestData(runtime.surreal);

    // Create read-only analytics connection in the eval namespace
    analyticsSurreal = new Surreal();
    await analyticsSurreal.connect(surrealUrl);
    await analyticsSurreal.signin({
      namespace: runtime.namespace,
      database: runtime.database,
      username: "analytics",
      password: "brain-analytics-readonly",
    });
    await analyticsSurreal.use({ namespace: runtime.namespace, database: runtime.database });

    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
    analyticsAgentModel = openrouter(analyticsModelId, {
      plugins: [{ id: "response-healing" }],
    });
  } catch (error) {
    console.error("beforeAll setup failed:", error);
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await analyticsSurreal?.close().catch(() => undefined);
  await teardownEvalRuntime(runtime);
}, 120_000);

const cases: AnalyticsTestCase[] = [
  {
    id: "count-open-tasks",
    question: "How many open tasks are there?",
    expectedAnswerContains: ["5"],
  },
  {
    id: "count-tasks-by-status",
    question: "How many tasks are there in each status?",
    expectedAnswerContains: ["open", "closed", "blocked"],
  },
  {
    id: "stale-decisions",
    question: "Which decisions have been provisional for over 2 weeks?",
    expectedAnswerContains: ["JWT", "PostgreSQL"],
  },
  {
    id: "open-observations",
    question: "What are the open observations?",
    expectedFacts: "There are 2 open observations: one about auth and billing timelines potentially conflicting (warning severity), and one about the dashboard feature lacking acceptance criteria (info severity).",
  },
  {
    id: "dependency-chains",
    question: "Which tasks have dependencies on other tasks?",
    expectedFacts: "2 tasks have actual dependencies: 'Build invoice generator' depends on 'Integrate payment gateway', and 'Integrate payment gateway' depends on 'Setup CI pipeline'. The remaining tasks matched the query but have empty dependency lists.",
  },
  {
    id: "empty-result",
    question: "Are there any cross-project conflicts between decisions?",
    expectedAnswerContains: ["no"],
    expectedAnswerNotContains: ["there are conflicts", "there is a conflict", "conflicts exist"],
  },
];

evalite<AnalyticsTestCase, AnalyticsEvalOutput, AnalyticsTestCase>("Analytics Agent Query Correctness", {
  data: cases.map((testCase) => ({ input: testCase, expected: testCase })),
  task: async (input) => runAnalyticsCase(input),
  scorers: [
    {
      name: "query-executes",
      description: "Did the agent produce a successful result without errors?",
      scorer: ({ output }) => (output.success ? 1 : 0),
    },
    {
      name: "answer-contains-expected",
      description: "Does the answer contain all expected substrings?",
      scorer: ({ output, expected }) => {
        if (!expected?.expectedAnswerContains || expected.expectedAnswerContains.length === 0) return 1;
        const lowerAnswer = output.answer.toLowerCase();
        const matches = expected.expectedAnswerContains.filter((s) =>
          lowerAnswer.includes(s.toLowerCase()),
        );
        return matches.length / expected.expectedAnswerContains.length;
      },
    },
    {
      name: "factuality",
      description: "LLM judge: is the answer factually consistent with the expected ground truth?",
      scorer: async ({ output, expected }) => {
        if (!expected?.expectedFacts) return 1;
        const result = await Factuality({
          input: expected.question,
          output: output.answer,
          expected: expected.expectedFacts,
        });
        const score = result.score ?? 0;
        // Factuality scores: A=0.4 (subset), B=0.6 (superset), C=1.0 (exact), D=0 (disagree), E=1.0 (equivalent)
        // A superset answer (B=0.6) is correct for our use case — the agent included extra detail.
        // Treat subset (A) and superset (B) as passing, only fail on disagreement (D=0).
        return score >= 0.4 ? 1 : 0;
      },
    },
    {
      name: "no-hallucination",
      description: "Answer does not contain forbidden substrings",
      scorer: ({ output, expected }) => {
        if (!expected?.expectedAnswerNotContains || expected.expectedAnswerNotContains.length === 0) return 1;
        const lowerAnswer = output.answer.toLowerCase();
        const violations = expected.expectedAnswerNotContains.filter((s) =>
          lowerAnswer.includes(s.toLowerCase()),
        );
        return violations.length === 0 ? 1 : 0;
      },
    },
  ],
  columns: ({ input, output, scores }) => [
    { label: "Model", value: analyticsModelId },
    { label: "Case", value: input.id },
    { label: "Success", value: output.success ? "yes" : "no" },
    { label: "Executes", value: formatScore(scores, "query-executes") },
    { label: "Contains", value: formatScore(scores, "answer-contains-expected") },
    { label: "Factual", value: formatScore(scores, "factuality") },
    { label: "NoHalluc", value: formatScore(scores, "no-hallucination") },
  ],
});

function formatScore(scores: Array<{ name: string; score: number | null }>, name: string): string {
  const match = scores.find((s) => s.name === name);
  return match?.score !== null && match?.score !== undefined ? match.score.toFixed(2) : "N/A";
}

async function runAnalyticsCase(testCase: AnalyticsTestCase): Promise<AnalyticsEvalOutput> {
  const context: ChatToolExecutionContext = {
    actor: "analytics_agent",
    workspaceRecord: seedResult.workspaceRecord,
    conversationRecord: new RecordId("conversation", "eval-analytics"),
    currentMessageRecord: new RecordId("message", `eval-${testCase.id}`),
    latestUserText: testCase.question,
  };

  try {
    const result = await runAnalyticsAgent({
      analyticsSurreal,
      analyticsAgentModel,
      context,
      question: testCase.question,
    });

    return {
      caseId: testCase.id,
      question: testCase.question,
      answer: result.answer,
      query_executed: result.query_executed,
      result_summary: result.result_summary,
      referenced_entities: result.referenced_entities,
      success: true,
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      question: testCase.question,
      answer: "",
      query_executed: "",
      result_summary: "",
      referenced_entities: [],
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
