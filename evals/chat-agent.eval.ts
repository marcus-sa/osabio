import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { evalite } from "evalite";
import { Factuality } from "autoevals";
import { beforeAll, afterAll } from "vitest";
import { RecordId } from "surrealdb";
import { runChatAgent } from "../app/src/server/chat/handler";
import {
  type EvalRuntime,
  setupEvalRuntime,
  teardownEvalRuntime,
  seedUserMessage,
} from "./eval-test-kit";
import { seedChatAgentTestData, type ChatAgentSeedResult } from "./chat-agent-seed-data";
import type { ChatAgentTestCase, ChatAgentEvalOutput } from "./types";
import { scoreToolInvoked } from "./scorers/tool-invoked";
import { scoreCorrectToolSelection } from "./scorers/correct-tool-selection";
import { scoreNoClarificationWhenClear } from "./scorers/no-clarification-when-clear";
import { scoreNoForbiddenTools } from "./scorers/no-forbidden-tools";

const chatAgentModelId = process.env.CHAT_AGENT_MODEL;
if (!chatAgentModelId) {
  throw new Error("CHAT_AGENT_MODEL env var is required for chat agent evals");
}

let runtime: EvalRuntime;
let seedResult: ChatAgentSeedResult;
let pmAgentModel: any;
let analyticsAgentModel: any;

beforeAll(async () => {
  try {
    runtime = await setupEvalRuntime("chat-agent");
    seedResult = await seedChatAgentTestData(runtime.surreal);

    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
    const pmModelId = process.env.PM_AGENT_MODEL?.trim() || process.env.EXTRACTION_MODEL!;
    pmAgentModel = openrouter(pmModelId, { plugins: [{ id: "response-healing" }] });

    const analyticsModelId = process.env.ANALYTICS_MODEL?.trim() || "unknown";
    analyticsAgentModel = openrouter(analyticsModelId, { plugins: [{ id: "response-healing" }] });
  } catch (error) {
    console.error("beforeAll setup failed:", error);
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await teardownEvalRuntime(runtime);
}, 120_000);

const WRITE_TOOLS = [
  "create_provisional_decision",
  "confirm_decision",
  "create_question",
  "create_observation",
  "invoke_pm_agent",
];

const cases: ChatAgentTestCase[] = [
  {
    id: "plan-work",
    userMessage: "I want to build a todo app with task lists, due dates, and collaboration features",
    expectsToolUse: true,
    expectedTools: ["invoke_pm_agent"],
    forbiddenResponsePatterns: ["would you like me to", "shall i"],
  },
  {
    id: "decision-explicit",
    userMessage: "We decided to use PostgreSQL for our database instead of MongoDB",
    expectsToolUse: true,
    expectedTools: ["create_provisional_decision"],
  },
  {
    id: "project-status",
    userMessage: "What's the status of Project Alpha?",
    expectsToolUse: true,
    expectedTools: ["get_project_status"],
  },
  {
    id: "hierarchy-action",
    userMessage: "I want the project hierarchy to be: Initiative -> Project -> Feature -> Task, and then questions, suggestions and decisions as cross-cutting concerns",
    expectsToolUse: true,
    expectedTools: ["invoke_pm_agent"],
    forbiddenResponsePatterns: [
      "would you like me to",
      "currently we have",
      "let me know",
      "the data model already",
      "the current model",
    ],
  },
  {
    id: "question-creation",
    userMessage: "Should we use React or Vue for the frontend?",
    expectsToolUse: true,
    expectedTools: ["create_question"],
  },
  {
    id: "greeting-no-action",
    userMessage: "Hey there! Just checking in.",
    expectsToolUse: false,
    forbiddenTools: WRITE_TOOLS,
  },
  {
    id: "workspace-status",
    userMessage: "What's the current state of the workspace?",
    expectsToolUse: true,
    expectedTools: ["list_workspace_entities"],
    forbiddenTools: WRITE_TOOLS,
  },
  {
    id: "multi-decision",
    userMessage: "Let's go with GitHub Actions for CI and Docker for containerization",
    expectsToolUse: true,
    expectedTools: ["create_provisional_decision"],
  },
];

evalite<ChatAgentTestCase, ChatAgentEvalOutput, ChatAgentTestCase>("Chat Agent Behavioral Correctness", {
  data: cases.map((testCase) => ({ input: testCase, expected: testCase })),
  task: async (input) => runChatAgentCase(input),
  scorers: [
    {
      name: "tool-invoked",
      description: "Agent used tools when action was expected, or abstained when not expected",
      scorer: ({ output, expected }) => (expected ? scoreToolInvoked(output, expected) : 1),
    },
    {
      name: "correct-tool-selection",
      description: "Agent called the expected tools",
      scorer: ({ output, expected }) => (expected ? scoreCorrectToolSelection(output, expected) : 1),
    },
    {
      name: "no-clarification-when-clear",
      description: "Agent did not ask unnecessary clarifying questions when action was clearly expected",
      scorer: ({ output, expected }) => (expected ? scoreNoClarificationWhenClear(output, expected) : 1),
    },
    {
      name: "no-forbidden-tools",
      description: "Agent did not call tools that should not have been invoked",
      scorer: ({ output, expected }) => (expected ? scoreNoForbiddenTools(output, expected) : 1),
    },
    {
      name: "response-contains",
      description: "Response contains all expected substrings",
      scorer: ({ output, expected }) => {
        if (!expected?.expectedResponseContains || expected.expectedResponseContains.length === 0) return 1;
        const lowerResponse = output.responseText.toLowerCase();
        const matches = expected.expectedResponseContains.filter((s) =>
          lowerResponse.includes(s.toLowerCase()),
        );
        return matches.length / expected.expectedResponseContains.length;
      },
    },
    {
      name: "factuality",
      description: "LLM judge: is the response factually consistent with expected ground truth?",
      scorer: async ({ output, expected }) => {
        if (!expected?.expectedFacts) return 1;
        const result = await Factuality({
          input: expected.userMessage,
          output: output.responseText,
          expected: expected.expectedFacts,
        });
        const score = result.score ?? 0;
        return score >= 0.4 ? 1 : 0;
      },
    },
  ],
  columns: ({ input, output, scores }) => [
    { label: "Model", value: chatAgentModelId! },
    { label: "Case", value: input.id },
    { label: "Tools", value: output.toolNames.join(", ") || "(none)" },
    { label: "Invoked", value: formatScore(scores, "tool-invoked") },
    { label: "Correct", value: formatScore(scores, "correct-tool-selection") },
    { label: "NoClarify", value: formatScore(scores, "no-clarification-when-clear") },
    { label: "NoForbid", value: formatScore(scores, "no-forbidden-tools") },
  ],
});

function formatScore(scores: Array<{ name: string; score: number | null }>, name: string): string {
  const match = scores.find((s) => s.name === name);
  return match?.score !== null && match?.score !== undefined ? match.score.toFixed(2) : "N/A";
}

async function runChatAgentCase(testCase: ChatAgentTestCase): Promise<ChatAgentEvalOutput> {
  const messageRecord = await seedUserMessage(
    runtime.surreal,
    seedResult.conversationRecord,
    testCase.userMessage,
  );

  try {
    const result = await runChatAgent({
      surreal: runtime.surreal,
      model: runtime.chatAgentModel,
      pmAgentModel,
      analyticsAgentModel,
      analyticsSurreal: runtime.surreal,
      embeddingModel: runtime.embeddingModel,
      embeddingDimension: runtime.config.embeddingDimension,
      extractionModelId: runtime.config.extractionModelId,
      extractionModel: runtime.extractionModel,
      extractionStoreThreshold: runtime.config.extractionStoreThreshold,
      conversationRecord: seedResult.conversationRecord,
      workspaceRecord: seedResult.workspaceRecord,
      currentMessageRecord: messageRecord,
      latestUserText: testCase.userMessage,
      workspaceOwnerRecord: seedResult.ownerRecord,
      messages: [
        ...(testCase.conversationHistory ?? []),
        { role: "user" as const, text: testCase.userMessage },
      ],
      onToken: () => {},
    });

    return {
      caseId: testCase.id,
      userMessage: testCase.userMessage,
      responseText: result.text,
      toolCalls: result.toolCalls,
      toolNames: [...new Set(result.toolCalls.map((tc) => tc.name))],
      success: true,
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      userMessage: testCase.userMessage,
      responseText: "",
      toolCalls: [],
      toolNames: [],
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
