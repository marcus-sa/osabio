/**
 * Session Trace Analyzer -- Cross-trace pattern detection at session end.
 *
 * When an agent session ends, this analyzer loads all traces from that session
 * and delegates to the OBSERVER_MODEL for cross-trace pattern analysis:
 * - Approach drift: early traces pick approach A, later traces implement approach B
 * - Accumulated contradictions: individually-acceptable traces that combined
 *   violate a confirmed decision
 * - Decision evolution: gradual shifting away from confirmed decisions
 *
 * Pipeline: load session traces -> filter end_turn only -> extract text
 *   -> skip if < 2 traces -> LLM cross-trace analysis -> confidence gate
 *   -> create conflict observations for verified patterns
 *
 * Dependencies injected as function parameters (hexagonal ports).
 */

import { RecordId, type Surreal } from "surrealdb";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { createObservation, type ObserveTargetRecord } from "../observation/queries";
import { logInfo, logError } from "../http/observability";
import { extractResponseText } from "./trace-response-analyzer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionTraceAnalysisInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  sessionId: string;
  observerModel: LanguageModel;
};

export type SessionTraceAnalysisResult = {
  observations_created: number;
  skipped: boolean;
  reason?: string;
  traces_analyzed: number;
};

type SessionTrace = {
  id: RecordId<"trace", string>;
  output?: Record<string, unknown>;
  stop_reason?: string;
  created_at: Date | string;
  model?: string;
};

// ---------------------------------------------------------------------------
// Cross-trace pattern schema (LLM output)
// ---------------------------------------------------------------------------

const crossTracePatternSchema = z.object({
  patterns: z.array(z.object({
    pattern_type: z.enum(["approach_drift", "accumulated_contradiction", "decision_evolution"])
      .describe("Type of cross-trace pattern detected"),
    description: z.string()
      .describe("Clear description of the pattern found across traces"),
    confidence: z.number()
      .describe("Confidence score 0.0-1.0"),
    trace_indices: z.array(z.number())
      .describe("Indices of traces involved in this pattern (0-based)"),
  })),
});

// ---------------------------------------------------------------------------
// Session trace loading
// ---------------------------------------------------------------------------

/**
 * Loads all traces for a given session, ordered chronologically.
 * Filters to end_turn traces only (tool_use traces are intermediate steps).
 */
async function loadSessionTraces(
  surreal: Surreal,
  sessionId: string,
): Promise<SessionTrace[]> {
  const sessionRecord = new RecordId("agent_session", sessionId);

  const [rows] = await surreal.query<[SessionTrace[]]>(
    `SELECT id, output, stop_reason, created_at, model FROM trace
     WHERE session = $sess
       AND stop_reason != "tool_use"
     ORDER BY created_at ASC;`,
    { sess: sessionRecord },
  );

  return rows ?? [];
}

/**
 * Loads confirmed decisions for the workspace for context.
 */
async function loadWorkspaceDecisions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<Array<{ summary: string; rationale?: string }>> {
  const [rows] = await surreal.query<[Array<{ summary: string; rationale?: string }>]>(
    `SELECT summary, rationale, created_at FROM decision
     WHERE workspace = $ws AND status = "confirmed"
     ORDER BY created_at DESC
     LIMIT 20;`,
    { ws: workspaceRecord },
  );
  return rows ?? [];
}

// ---------------------------------------------------------------------------
// LLM cross-trace analysis
// ---------------------------------------------------------------------------

/**
 * Delegates to the observer model for cross-trace pattern detection.
 * Sends all trace response texts with confirmed decisions as context.
 */
async function analyzeCrossTracePatterns(
  model: LanguageModel,
  traceTexts: Array<{ index: number; text: string }>,
  decisions: Array<{ summary: string; rationale?: string }>,
): Promise<z.infer<typeof crossTracePatternSchema>> {
  const { generateObject } = await import("ai");

  const decisionContext = decisions.length > 0
    ? decisions.map((d, i) => `${i + 1}. ${d.summary}${d.rationale ? ` (Rationale: ${d.rationale})` : ""}`).join("\n")
    : "No confirmed decisions in workspace.";

  const traceContext = traceTexts.map((t) =>
    `--- Trace ${t.index + 1} ---\n${t.text.slice(0, 1500)}`,
  ).join("\n\n");

  const { object } = await generateObject({
    model,
    schema: crossTracePatternSchema,
    prompt: `You are an AI governance observer analyzing a sequence of LLM responses from a single coding session for cross-trace patterns.

CONFIRMED WORKSPACE DECISIONS:
${decisionContext}

SESSION TRACES (chronological order):
${traceContext}

Analyze these traces for cross-trace patterns that would be invisible when examining each trace individually:

1. APPROACH DRIFT: Early traces follow one approach (aligned with decisions) but later traces switch to a different approach (contradicting decisions). Look for a clear progression from compliant to non-compliant.

2. ACCUMULATED CONTRADICTION: Individual traces each make small deviations that seem acceptable alone, but combined they represent a systematic violation of a confirmed decision. Look for repeated exceptions or workarounds.

3. DECISION EVOLUTION: Traces show gradual weakening of adherence to a decision, with increasing justifications for departing from it.

Only report patterns with confidence >= 0.6. If no cross-trace patterns are found, return an empty patterns array.`,
  });

  return object;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const CONFIDENCE_GATE = 0.6;

/**
 * Analyzes all traces from a completed session for cross-trace patterns.
 *
 * Skips analysis when:
 * - Session has fewer than 2 traces (no cross-trace patterns possible)
 * - No extractable text from traces
 *
 * Creates conflict observations for verified patterns.
 */
export async function analyzeSessionTraces(
  input: SessionTraceAnalysisInput,
): Promise<SessionTraceAnalysisResult> {
  const { surreal, workspaceRecord, sessionId, observerModel } = input;

  // Load session traces
  const traces = await loadSessionTraces(surreal, sessionId);

  if (traces.length < 2) {
    logInfo("observer.session.skipped", "Session skipped: fewer than 2 traces", {
      sessionId,
      traceCount: traces.length,
    });
    return {
      observations_created: 0,
      skipped: true,
      reason: traces.length === 0 ? "no_traces" : "single_trace",
      traces_analyzed: traces.length,
    };
  }

  // Extract text from each trace
  const traceTexts = traces
    .map((trace, index) => ({
      index,
      traceId: trace.id,
      text: extractResponseText(trace.output),
    }))
    .filter((t) => t.text.trim().length > 0);

  if (traceTexts.length < 2) {
    logInfo("observer.session.skipped", "Session skipped: fewer than 2 traces with extractable text", {
      sessionId,
      traceCount: traces.length,
      extractableCount: traceTexts.length,
    });
    return {
      observations_created: 0,
      skipped: true,
      reason: "insufficient_text",
      traces_analyzed: traceTexts.length,
    };
  }

  // Load workspace decisions for context
  const decisions = await loadWorkspaceDecisions(surreal, workspaceRecord);

  // Run LLM cross-trace analysis
  let analysisResult: z.infer<typeof crossTracePatternSchema>;
  try {
    analysisResult = await analyzeCrossTracePatterns(
      observerModel,
      traceTexts.map((t) => ({ index: t.index, text: t.text })),
      decisions,
    );
  } catch (error) {
    logError("observer.session.llm_error", "Cross-trace LLM analysis failed", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      observations_created: 0,
      skipped: true,
      reason: "llm_error",
      traces_analyzed: traceTexts.length,
    };
  }

  // Apply confidence gate and create observations
  let observationsCreated = 0;
  const sessionRecord = new RecordId("agent_session", sessionId);

  const verifiedPatterns = analysisResult.patterns.filter(
    (p) => p.confidence >= CONFIDENCE_GATE,
  );

  for (const pattern of verifiedPatterns) {
    // Build related records: session + involved traces
    const relatedRecords: ObserveTargetRecord[] = [];

    for (const idx of pattern.trace_indices) {
      const traceEntry = traceTexts[idx];
      if (traceEntry) {
        relatedRecords.push(traceEntry.traceId as ObserveTargetRecord);
      }
    }

    const observationText = `Cross-trace ${pattern.pattern_type}: ${pattern.description}`;

    try {
      await createObservation({
        surreal,
        workspaceRecord,
        text: observationText,
        severity: "conflict",
        sourceAgent: "observer_agent",
        observationType: "contradiction",
        now: new Date(),
        relatedRecords: relatedRecords.length > 0 ? relatedRecords : [sessionRecord as unknown as ObserveTargetRecord],
        confidence: pattern.confidence,
        verified: true,
        source: "llm",
      });

      observationsCreated += 1;

      logInfo("observer.session.pattern_found", "Cross-trace pattern observation created", {
        sessionId,
        patternType: pattern.pattern_type,
        confidence: pattern.confidence,
        traceIndices: pattern.trace_indices,
      });
    } catch (error) {
      logError("observer.session.observation_error", "Failed to create pattern observation", {
        sessionId,
        patternType: pattern.pattern_type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logInfo("observer.session.analysis_complete", "Session trace analysis complete", {
    sessionId,
    tracesAnalyzed: traceTexts.length,
    patternsFound: analysisResult.patterns.length,
    verifiedPatterns: verifiedPatterns.length,
    observationsCreated,
  });

  return {
    observations_created: observationsCreated,
    skipped: false,
    traces_analyzed: traceTexts.length,
  };
}
