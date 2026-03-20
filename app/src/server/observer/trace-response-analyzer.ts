/**
 * Trace Response Analyzer — Observer intelligence for per-trace analysis.
 *
 * Pure analysis pipeline that examines LLM call traces for:
 * 1. Contradictions with confirmed workspace decisions (Tier 1 KNN + Tier 2 LLM)
 * 2. Unrecorded decisions (decision-shaped statements with no matching record)
 *
 * Pipeline: extract text -> check stop_reason -> embed response
 *   -> KNN against confirmed decisions -> Tier 2 LLM verification
 *   -> create observations
 *
 * Dependencies injected as function parameters (hexagonal ports).
 * All domain logic is pure; IO happens at the boundary via injected adapters.
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { extractSearchTerms } from "../graph/bm25-search";
import { createObservation, type ObserveTargetRecord } from "../observation/queries";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TraceAnalysisInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  traceId: string;
  traceBody?: Record<string, unknown>;
  observerModel: LanguageModel;
};

export type TraceAnalysisResult = {
  observations_created: number;
  skipped: boolean;
  reason?: string;
};

type DecisionCandidate = {
  id: RecordId<"decision", string>;
  summary: string;
  rationale?: string;
  score: number;
};

type ContradictionVerdict = {
  isContradiction: boolean;
  confidence: number;
  reasoning: string;
};

// ---------------------------------------------------------------------------
// Response text extraction (pure)
// ---------------------------------------------------------------------------

/**
 * Extracts readable text from the trace output FLEXIBLE field.
 * Handles Anthropic-style content blocks: text blocks and tool inputs.
 */
export function extractResponseText(output?: Record<string, unknown>): string {
  if (!output) return "";

  const parts: string[] = [];

  // Extract from content array (Anthropic Messages API format)
  const content = output.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "object" && block !== null) {
        const typedBlock = block as Record<string, unknown>;
        if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
          parts.push(typedBlock.text);
        }
        if (typedBlock.type === "tool_use" && typeof typedBlock.input === "object" && typedBlock.input !== null) {
          // Include tool inputs as they may contain decision-shaped content
          parts.push(JSON.stringify(typedBlock.input));
        }
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Checks whether a trace should be analyzed based on stop_reason.
 * Tool-use stop reasons indicate intermediate loop steps -- skip them.
 */
export function shouldAnalyzeTrace(
  stopReason?: string,
  traceBody?: Record<string, unknown>,
): boolean {
  // Check stop_reason from trace body top-level field
  const reason = stopReason
    ?? (traceBody?.stop_reason as string | undefined)
    ?? (traceBody?.output as Record<string, unknown> | undefined)?.stop_reason as string | undefined;

  if (reason === "tool_use") {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// BM25 decision search
// ---------------------------------------------------------------------------

/**
 * Finds confirmed decisions similar to the given text using BM25 fulltext search.
 */
async function findSimilarDecisionsByText(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  searchText: string,
): Promise<DecisionCandidate[]> {
  // BM25 @N@ does AND matching — search per-term and merge results.
  const termList = extractSearchTerms(searchText, 4)
    .split(" ")
    .filter((t) => t.length > 0);
  if (termList.length === 0) return [];

  const sql = `SELECT id, summary, rationale, search::score(1) AS score
     FROM decision
     WHERE summary @1@ $query
     AND workspace = $ws
     AND status = 'confirmed'
     ORDER BY score DESC
     LIMIT 10;`;

  type DecRow = { id: RecordId<"decision", string>; summary: string; rationale?: string; score: number };
  const seen = new Map<string, DecRow>();
  for (const term of termList) {
    const [rows] = await surreal.query<[DecRow[]]>(sql, { ws: workspaceRecord, query: term });
    for (const row of rows ?? []) {
      const key = row.id.id as string;
      const existing = seen.get(key);
      if (!existing || row.score > existing.score) {
        seen.set(key, row);
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tier 2 LLM verification
// ---------------------------------------------------------------------------

/**
 * Verifies whether a trace response actually contradicts a specific decision.
 * Returns structured verdict with confidence score.
 */
async function verifyContradiction(
  model: LanguageModel,
  responseText: string,
  decision: DecisionCandidate,
): Promise<ContradictionVerdict> {
  const { generateObject } = await import("ai");
  const { createTelemetryConfig } = await import("../telemetry/ai-telemetry");
  const { FUNCTION_IDS } = await import("../telemetry/function-ids");

  const contradictionSchema = z.object({
    is_contradiction: z.boolean().describe("Whether the response contradicts the decision"),
    confidence: z.number().describe("Confidence score 0.0-1.0"),
    reasoning: z.string().describe("Brief explanation"),
  });

  const { object } = await generateObject({
    model,
    schema: contradictionSchema,
    experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.OBSERVER_VERIFICATION),
    prompt: `You are an AI governance observer. Determine if this LLM response contradicts a confirmed workspace decision.

CONFIRMED DECISION:
Summary: ${decision.summary}
${decision.rationale ? `Rationale: ${decision.rationale}` : ""}

LLM RESPONSE EXCERPT:
${responseText.slice(0, 2000)}

Does the LLM response implement or recommend something that directly contradicts this decision? Consider:
- Is the response actively violating the decision (not just mentioning alternatives)?
- Is the contradiction about the same domain/scope as the decision?
- Could the response be about external/third-party systems (not covered by the decision)?

Respond with is_contradiction (true/false), confidence (0.0-1.0), and brief reasoning.`,
  });

  return {
    isContradiction: object.is_contradiction,
    confidence: object.confidence,
    reasoning: object.reasoning,
  };
}

/**
 * Verifies whether a trace response contains an unrecorded decision.
 * Checks if the text makes architectural/strategic choices not in the graph.
 */
async function verifyMissingDecision(
  model: LanguageModel,
  responseText: string,
): Promise<{ isDecision: boolean; confidence: number; summary: string; reasoning: string }> {
  const { generateObject } = await import("ai");
  const { createTelemetryConfig } = await import("../telemetry/ai-telemetry");
  const { FUNCTION_IDS } = await import("../telemetry/function-ids");

  const missingDecisionSchema = z.object({
    is_decision: z.boolean().describe("Whether the response contains an unrecorded architectural/strategic decision"),
    confidence: z.number().describe("Confidence score 0.0-1.0"),
    summary: z.string().describe("Brief summary of the decision found, or empty string"),
    reasoning: z.string().describe("Brief explanation of why this is or is not an unrecorded decision"),
  });

  const { object } = await generateObject({
    model,
    schema: missingDecisionSchema,
    experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.OBSERVER_VERIFICATION),
    prompt: `You are an AI governance observer. Determine if this LLM response contains an architectural or strategic decision that should be tracked.

LLM RESPONSE:
${responseText.slice(0, 2000)}

Decision signals to look for:
- "I've decided to use X instead of Y"
- "The right approach is X because..."
- Technology/framework/architecture choices with rationale
- Trade-off resolutions ("we should use X for this use case")

NOT decisions:
- Implementation details (variable names, code formatting)
- Following existing instructions/conventions
- Asking questions or presenting options without choosing

Does this response contain a decision-shaped statement? Respond with is_decision, confidence (0.0-1.0), a summary of the decision if found, and reasoning explaining your analysis.`,
  });

  return {
    isDecision: object.is_decision,
    confidence: object.confidence,
    summary: object.summary,
    reasoning: object.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Contradiction detection pipeline
// ---------------------------------------------------------------------------

async function detectContradictions(
  input: TraceAnalysisInput,
  responseText: string,
  config: { tier2ConfidenceMin: number },
): Promise<number> {
  const { surreal, workspaceRecord, traceId, observerModel } = input;
  const traceRecord = new RecordId("trace", traceId);

  // Tier 1: BM25 search for similar confirmed decisions
  const candidates = await findSimilarDecisionsByText(
    surreal,
    workspaceRecord,
    responseText,
  );

  if (candidates.length === 0) {
    log.info("observer.trace.no_candidates", "No similar decisions found for trace", { traceId });
    return 0;
  }

  log.info("observer.trace.candidates_found", "KNN candidates for contradiction check", {
    traceId,
    candidateCount: candidates.length,
  });

  // Tier 2: LLM verification on each candidate
  let observationsCreated = 0;

  for (const candidate of candidates) {
    try {
      const verdict = await verifyContradiction(observerModel, responseText, candidate);

      if (!verdict.isContradiction || verdict.confidence < config.tier2ConfidenceMin) {
        log.info("observer.trace.not_contradicted", "Candidate not contradicted or low confidence", {
          traceId,
          decisionId: candidate.id.id,
          isContradiction: verdict.isContradiction,
          confidence: verdict.confidence,
        });
        continue;
      }

      // Create contradiction observation
      const decisionRecord = new RecordId("decision", candidate.id.id as string) as ObserveTargetRecord;

      await createObservation({
        surreal,
        workspaceRecord,
        text: `Trace response contradicts confirmed decision "${candidate.summary}": ${verdict.reasoning}`,
        severity: "conflict",
        sourceAgent: "observer_agent",
        observationType: "contradiction",
        now: new Date(),
        relatedRecords: [traceRecord as ObserveTargetRecord, decisionRecord],
        confidence: verdict.confidence,
        verified: true,
        source: "llm",
        reasoning: verdict.reasoning,
      });

      observationsCreated += 1;

      log.info("observer.trace.contradiction_found", "Contradiction observation created", {
        traceId,
        decisionId: candidate.id.id,
        confidence: verdict.confidence,
      });
    } catch (error) {
      log.error("observer.trace.verification_error", "Tier 2 verification failed for candidate", {
        traceId,
        decisionId: candidate.id.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with other candidates -- fail-skip per candidate
    }
  }

  return observationsCreated;
}

// ---------------------------------------------------------------------------
// Missing decision detection pipeline
// ---------------------------------------------------------------------------

async function detectMissingDecisions(
  input: TraceAnalysisInput,
  responseText: string,
  config: { tier2ConfidenceMin: number },
): Promise<number> {
  const { surreal, workspaceRecord, traceId, observerModel } = input;
  const traceRecord = new RecordId("trace", traceId);

  // First check if the response contains decision signals via LLM
  try {
    const missingResult = await verifyMissingDecision(observerModel, responseText);

    if (!missingResult.isDecision || missingResult.confidence < config.tier2ConfidenceMin) {
      return 0;
    }

    // Check if a similar decision already exists (BM25 search)
    const existingDecisions = await findSimilarDecisionsByText(
      surreal,
      workspaceRecord,
      missingResult.summary,
    );

    // If we found a similar existing decision, it's not "missing"
    if (existingDecisions.length > 0) {
      log.info("observer.trace.decision_exists", "Decision-shaped content matches existing decision", {
        traceId,
        matchedDecisionId: existingDecisions[0].id.id,
      });
      return 0;
    }

    // No matching decision found -- create info observation
    await createObservation({
      surreal,
      workspaceRecord,
      text: `Unrecorded decision detected in trace: ${missingResult.summary}`,
      severity: "info",
      sourceAgent: "observer_agent",
      observationType: "validation",
      now: new Date(),
      relatedRecords: [traceRecord as ObserveTargetRecord],
      confidence: missingResult.confidence,
      verified: true,
      source: "llm",
      reasoning: missingResult.reasoning,
    });

    log.info("observer.trace.missing_decision", "Unrecorded decision observation created", {
      traceId,
      summary: missingResult.summary,
    });

    return 1;
  } catch (error) {
    log.error("observer.trace.missing_detection_error", "Missing decision detection failed", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

async function loadIntelligenceConfig(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<{
  enabled: boolean;
  tier1Threshold: number;
  tier2ConfidenceMin: number;
} | undefined> {
  const [rows] = await surreal.query<[Array<{
    contradiction_detection_enabled: boolean;
    contradiction_tier1_threshold: number;
    contradiction_tier2_confidence_min: number;
  }>]>(
    `SELECT contradiction_detection_enabled, contradiction_tier1_threshold, contradiction_tier2_confidence_min
     FROM proxy_intelligence_config
     WHERE workspace = $ws
     LIMIT 1;`,
    { ws: workspaceRecord },
  );

  const config = rows?.[0];
  if (!config) return undefined;

  return {
    enabled: config.contradiction_detection_enabled,
    tier1Threshold: config.contradiction_tier1_threshold,
    tier2ConfidenceMin: config.contradiction_tier2_confidence_min,
  };
}

// ---------------------------------------------------------------------------
// Main analysis entry point
// ---------------------------------------------------------------------------

/**
 * Analyzes an LLM call trace for contradictions and missing decisions.
 *
 * Pipeline:
 * 1. Check stop_reason -- skip tool_use (intermediate loop step)
 * 2. Extract text blocks from output FLEXIBLE field
 * 3. Contradiction detection: embed response -> KNN against decisions -> LLM verify
 * 4. Missing decision detection: extract signals -> embed -> KNN -> LLM verify
 *
 * Returns 200-safe result on all analysis errors (fail-skip pattern).
 */
export async function analyzeTraceResponse(
  input: TraceAnalysisInput,
): Promise<TraceAnalysisResult> {
  const { surreal, workspaceRecord, traceId, traceBody } = input;

  // Step 1: Check stop_reason
  if (!shouldAnalyzeTrace(undefined, traceBody)) {
    log.info("observer.trace.skipped", "Trace skipped: tool_use stop_reason", { traceId });
    return { observations_created: 0, skipped: true, reason: "tool_use" };
  }

  // Step 2: Extract response text
  const output = traceBody?.output as Record<string, unknown> | undefined;
  const responseText = extractResponseText(output);

  if (responseText.trim().length === 0) {
    log.info("observer.trace.empty", "Trace skipped: no extractable text", { traceId });
    return { observations_created: 0, skipped: true, reason: "empty_response" };
  }

  // Load intelligence config
  const config = await loadIntelligenceConfig(surreal, workspaceRecord);
  if (!config || !config.enabled) {
    log.info("observer.trace.config_disabled", "Trace analysis skipped: not enabled", { traceId });
    return { observations_created: 0, skipped: true, reason: "not_enabled" };
  }

  // Step 3: Run both detection pipelines (BM25-based)
  const [contradictionCount, missingCount] = await Promise.all([
    detectContradictions(input, responseText, config),
    detectMissingDecisions(input, responseText, config),
  ]);

  const totalObservations = contradictionCount + missingCount;

  log.info("observer.trace.analysis_complete", "Trace analysis complete", {
    traceId,
    contradictions: contradictionCount,
    missingDecisions: missingCount,
    totalObservations,
  });

  return {
    observations_created: totalObservations,
    skipped: false,
  };
}
