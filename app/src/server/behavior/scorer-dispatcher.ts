/**
 * Scorer Dispatcher -- Routes telemetry scoring to LLM scorer.
 *
 * For each matched definition, produces an independent score via LLM.
 * Persists scored behavior records via createBehavior.
 */

import type { LanguageModel } from "ai";
import type { Surreal } from "surrealdb";
import type { BehaviorDefinitionRecord, LlmScorerResult } from "./definition-types";
import { scoreTelemetryWithLlm } from "./llm-scorer";
import { createBehavior, type BehaviorInput } from "./queries";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoringRequest = {
  telemetryType: string;
  telemetryPayload: Record<string, unknown>;
  identityId: string;
  workspaceId: string;
  sessionId?: string;
};

export type ScoredResult = {
  definitionId: string;
  definitionTitle: string;
  definitionVersion: number;
  score: number;
  rationale?: string;
  evidenceChecked?: string[];
  behaviorId: string;
};

export type DispatcherDependencies = {
  surreal: Surreal;
  scorerModel: LanguageModel;
};

// ---------------------------------------------------------------------------
// Score a single definition against telemetry
// ---------------------------------------------------------------------------

async function scoreOneDefinition(
  definition: BehaviorDefinitionRecord,
  request: ScoringRequest,
  deps: DispatcherDependencies,
): Promise<ScoredResult | undefined> {
  const definitionId = definition.id.id as string;

  const llmResult: LlmScorerResult | undefined = await scoreTelemetryWithLlm(
    deps.scorerModel,
    definition,
    request.telemetryPayload,
  );

  if (!llmResult) {
    log.info("behavior.dispatcher", "LLM scorer returned no result (timeout or failure)", {
      definition_title: definition.title,
    });
    return undefined;
  }

  const { behaviorId } = await persistScore(deps.surreal, request, {
    definitionId,
    definitionVersion: definition.version,
    metricType: definition.title,
    score: llmResult.score,
    sourceTelemetry: {
      rationale: llmResult.rationale,
      evidence_checked: llmResult.evidence_checked,
      definition_version: definition.version,
      telemetry_type: request.telemetryType,
    },
  });

  return {
    definitionId,
    definitionTitle: definition.title,
    definitionVersion: definition.version,
    score: llmResult.score,
    rationale: llmResult.rationale,
    evidenceChecked: llmResult.evidence_checked,
    behaviorId,
  };
}

// ---------------------------------------------------------------------------
// Persist Score (IO boundary)
// ---------------------------------------------------------------------------

async function persistScore(
  surreal: Surreal,
  request: ScoringRequest,
  score: {
    definitionId: string;
    definitionVersion: number;
    metricType: string;
    score: number;
    sourceTelemetry: Record<string, unknown>;
  },
): Promise<{ behaviorId: string }> {
  const input: BehaviorInput = {
    metricType: score.metricType,
    score: score.score,
    sourceTelemetry: score.sourceTelemetry,
    workspaceId: request.workspaceId,
    sessionId: request.sessionId,
    definitionId: score.definitionId,
    definitionVersion: score.definitionVersion,
  };

  return createBehavior(surreal, request.identityId, input);
}

// ---------------------------------------------------------------------------
// Public API: Dispatch scoring for matched definitions
// ---------------------------------------------------------------------------

/**
 * Scores telemetry against each matched definition independently via LLM.
 * Returns an array of scored results (one per definition that produced a score).
 * Definitions that fail scoring are omitted from results (no partial failures).
 */
export async function dispatchScoring(
  matchedDefinitions: readonly BehaviorDefinitionRecord[],
  request: ScoringRequest,
  deps: DispatcherDependencies,
): Promise<ScoredResult[]> {
  if (matchedDefinitions.length === 0) return [];

  log.info("behavior.dispatcher", "Dispatching scoring", {
    telemetry_type: request.telemetryType,
    matched_definitions: matchedDefinitions.length,
  });

  const results: ScoredResult[] = [];

  for (const definition of matchedDefinitions) {
    const result = await scoreOneDefinition(definition, request, deps);
    if (result) {
      results.push(result);
    }
  }

  log.info("behavior.dispatcher", "Scoring complete", {
    telemetry_type: request.telemetryType,
    scored: results.length,
    skipped: matchedDefinitions.length - results.length,
  });

  return results;
}
