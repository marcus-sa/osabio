import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { evalite } from "evalite";
import { Surreal } from "surrealdb";
import { afterAll, beforeAll } from "vitest";
import { runAnalyticsAgent, type AnalyticsAgentOutput } from "../app/src/server/agents/analytics/agent";
import type { ChatToolExecutionContext } from "../app/src/server/chat/tools/types";
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
  expectedAnswerContains: string[];
  expectedAnswerNotContains?: string[];
};

type AnalyticsEvalOutput = {
  caseId: string;
  question: string;
  answer: string;
  query_executed: string;
  result_summary: string;
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
    question: "Are there any open observations?",
    expectedAnswerContains: ["conflict", "acceptance criteria"],
  },
  {
    id: "dependency-chains",
    question: "Which tasks have dependencies on other tasks?",
    expectedAnswerContains: ["payment gateway", "invoice generator"],
  },
  {
    id: "empty-result",
    question: "Are there any cross-project conflicts between decisions?",
    expectedAnswerContains: [],
    expectedAnswerNotContains: ["found", "detected"],
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
        if (!expected || expected.expectedAnswerContains.length === 0) return 1;
        const lowerAnswer = output.answer.toLowerCase();
        const matches = expected.expectedAnswerContains.filter((s) =>
          lowerAnswer.includes(s.toLowerCase()),
        );
        return matches.length / expected.expectedAnswerContains.length;
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
      success: true,
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      question: testCase.question,
      answer: "",
      query_executed: "",
      result_summary: "",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
