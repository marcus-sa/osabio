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
import type { embed } from "ai";
import { z } from "zod";
import { createObservation, type ObserveTargetRecord } from "../observation/queries";
import { createEmbeddingVector } from "../graph/embeddings";
import { log } from "../telemetry/logger";

type EmbeddingModel = Parameters<typeof embed>[0]["model"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TraceAnalysisInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  traceId: string;
  traceBody?: Record<string, unknown>;
  observerModel: LanguageModel;
  embeddingModel: EmbeddingModel;
  embeddingDimension: number;
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
// KNN decision search (two-step SurrealDB v3.0 workaround)
// ---------------------------------------------------------------------------

/**
 * Finds confirmed decisions similar to the given embedding using two-step
 * KNN query pattern (SurrealDB v3.0 workaround for KNN + WHERE bug).
 *
 * Step 1: KNN on HNSW index (no WHERE filter)
 * Step 2: Filter by workspace + confirmed status (B-tree index)
 */
async function findSimilarDecisions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  responseEmbedding: number[],
  threshold: number,
): Promise<DecisionCandidate[]> {
  const results = await surreal.query(
    `LET $candidates = SELECT id, summary, rationale, workspace, status,
        vector::similarity::cosine(embedding, $vec) AS score
      FROM decision WHERE embedding <|20, COSINE|> $vec;
     SELECT id, summary, rationale, score FROM $candidates
      WHERE workspace = $ws AND status = 'confirmed'
        AND score >= $threshold
      ORDER BY score DESC
      LIMIT 10;`,
    { vec: responseEmbedding, ws: workspaceRecord, threshold },
  );

  // Two-statement query: results[1] is the filtered result
  const rows = (results[1] ?? []) as Array<{
    id: RecordId<"decision", string>;
    summary: string;
    rationale?: string;
    score: number;
  }>;

  return rows;
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
): Promise<{ isDecision: boolean; confidence: number; summary: string }> {
  const { generateObject } = await import("ai");
  const { createTelemetryConfig } = await import("../telemetry/ai-telemetry");
  const { FUNCTION_IDS } = await import("../telemetry/function-ids");

  const missingDecisionSchema = z.object({
    is_decision: z.boolean().describe("Whether the response contains an unrecorded architectural/strategic decision"),
    confidence: z.number().describe("Confidence score 0.0-1.0"),
    summary: z.string().describe("Brief summary of the decision found, or empty string"),
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

Does this response contain a decision-shaped statement? Respond with is_decision, confidence (0.0-1.0), and a summary of the decision if found.`,
  });

  return {
    isDecision: object.is_decision,
    confidence: object.confidence,
    summary: object.summary,
  };
}

// ---------------------------------------------------------------------------
// Contradiction detection pipeline
// ---------------------------------------------------------------------------

async function detectContradictions(
  input: TraceAnalysisInput,
  responseText: string,
  responseEmbedding: number[],
  config: { tier1Threshold: number; tier2ConfidenceMin: number },
): Promise<number> {
  const { surreal, workspaceRecord, traceId, observerModel } = input;
  const traceRecord = new RecordId("trace", traceId);

  // Tier 1: KNN search for similar confirmed decisions
  const candidates = await findSimilarDecisions(
    surreal,
    workspaceRecord,
    responseEmbedding,
    config.tier1Threshold,
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
  responseEmbedding: number[],
  config: { tier1Threshold: number; tier2ConfidenceMin: number },
): Promise<number> {
  const { surreal, workspaceRecord, traceId, observerModel } = input;
  const traceRecord = new RecordId("trace", traceId);

  // First check if the response contains decision signals via LLM
  try {
    const missingResult = await verifyMissingDecision(observerModel, responseText);

    if (!missingResult.isDecision || missingResult.confidence < config.tier2ConfidenceMin) {
      return 0;
    }

    // Check if a similar decision already exists (KNN search)
    const existingDecisions = await findSimilarDecisions(
      surreal,
      workspaceRecord,
      responseEmbedding,
      config.tier1Threshold,
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
  const { surreal, workspaceRecord, traceId, traceBody, embeddingModel, embeddingDimension } = input;

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

  // Step 3: Embed the response text
  const responseEmbedding = await createEmbeddingVector(
    embeddingModel,
    responseText.slice(0, 4000), // Limit embedding input
    embeddingDimension,
  );

  if (!responseEmbedding) {
    log.error("observer.trace.embedding_failed", "Failed to embed trace response", { traceId });
    return { observations_created: 0, skipped: true, reason: "embedding_failed" };
  }

  // Step 4: Run both detection pipelines
  const [contradictionCount, missingCount] = await Promise.all([
    detectContradictions(input, responseText, responseEmbedding, config),
    detectMissingDecisions(input, responseText, responseEmbedding, config),
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
