/**
 * LLM Scorer -- Effect boundary for behavior scoring via AI SDK generateObject.
 *
 * Pure prompt building + single LLM call per invocation.
 * Returns LlmScorerResult { score, rationale, evidence_checked } or undefined on failure.
 *
 * Timeout: 30s per call. Failures return undefined (caller decides retry strategy).
 */

import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { logError, logInfo } from "../http/observability";
import type { BehaviorDefinitionRecord, LlmScorerResult } from "./definition-types";

// ---------------------------------------------------------------------------
// Output Schema (Zod for generateObject structured output)
// ---------------------------------------------------------------------------

const llmScorerResultSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(1)
    .describe("Behavior adherence score from 0.0 (complete violation) to 1.0 (perfect adherence)"),
  rationale: z
    .string()
    .describe("Brief explanation of the score, referencing specific evidence or lack thereof"),
  evidence_checked: z
    .array(z.string())
    .describe("List of graph entity references checked during evaluation (e.g. 'decision:d42', 'task:t15')"),
});

// ---------------------------------------------------------------------------
// Prompt Builder (pure)
// ---------------------------------------------------------------------------

export function buildScoringPrompt(
  definition: Pick<BehaviorDefinitionRecord, "goal" | "scoring_logic" | "title">,
  telemetryPayload: Record<string, unknown>,
  graphEvidence?: string,
): string {
  const evidenceSection = graphEvidence
    ? `\n## Graph Evidence\n${graphEvidence}`
    : "\n## Graph Evidence\nNo graph evidence available for this evaluation.";

  return `You are a behavior scorer evaluating whether an AI agent's action adheres to a defined behavioral standard.

## Behavior Definition
- Title: ${definition.title}
- Goal: ${definition.goal}
- Scoring Logic: ${definition.scoring_logic}

## Telemetry Payload
${JSON.stringify(telemetryPayload, null, 2)}
${evidenceSection}

## Instructions
1. Evaluate the telemetry payload against the behavior definition's goal and scoring logic.
2. Assign a score from 0.0 to 1.0 based on the scoring logic criteria.
3. Provide a rationale explaining your score, referencing specific evidence.
4. List all graph entity references you checked (even if they were absent).`;
}

// ---------------------------------------------------------------------------
// LLM Scorer (effect boundary)
// ---------------------------------------------------------------------------

const SCORER_TIMEOUT_MS = 30_000;

/**
 * Scores a telemetry event against a behavior definition using an LLM.
 * Returns undefined on any failure (timeout, rate limit, invalid output).
 */
export async function scoreTelemetryWithLlm(
  model: LanguageModel,
  definition: Pick<BehaviorDefinitionRecord, "goal" | "scoring_logic" | "title">,
  telemetryPayload: Record<string, unknown>,
  graphEvidence?: string,
): Promise<LlmScorerResult | undefined> {
  const prompt = buildScoringPrompt(definition, telemetryPayload, graphEvidence);

  try {
    const result = await generateObject({
      model,
      schema: llmScorerResultSchema,
      prompt,
      abortSignal: AbortSignal.timeout(SCORER_TIMEOUT_MS),
    });

    logInfo("behavior.scorer.llm", "LLM scoring complete", {
      definition_title: definition.title,
      score: result.object.score,
    });

    return result.object;
  } catch (error) {
    logError("behavior.scorer.llm", "LLM scoring failed", {
      definition_title: definition.title,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
