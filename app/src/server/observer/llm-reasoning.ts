/**
 * LLM reasoning: effect boundary for generateObject calls in verification pipeline.
 *
 * Each function makes a single LLM call with structured output schema.
 * All calls use AbortSignal.timeout(10_000) for latency control.
 * Returns undefined on any failure (timeout, rate limit, invalid output).
 */

import { generateObject, type LanguageModel } from "ai";
import { logError, logInfo } from "../http/observability";
import { llmVerdictSchema, peerReviewVerdictSchema, type LlmVerdict, type PeerReviewVerdict } from "./schemas";
import { validateEvidenceRefs } from "./evidence-validator";
import type { EntityContext } from "./context-loader";
import type { VerificationResult } from "./verification-pipeline";

// ---------------------------------------------------------------------------
// Verification verdict (semantic verification)
// ---------------------------------------------------------------------------

export async function generateVerificationVerdict(
  model: LanguageModel,
  context: EntityContext,
  deterministicVerdict: VerificationResult,
): Promise<LlmVerdict | undefined> {
  const start = Date.now();

  try {
    const decisionsText = context.relatedDecisions.length > 0
      ? context.relatedDecisions.map((d) =>
          `- [${d.table_id}] (${d.status}) ${d.summary}${d.rationale ? ` — ${d.rationale}` : ""}`,
        ).join("\n")
      : "No related decisions found.";

    const result = await generateObject({
      model,
      schema: llmVerdictSchema,
      prompt: `You are a verification agent analyzing whether an entity aligns with or contradicts confirmed decisions.

## Entity Under Review
- Type: ${context.entityTable}
- ID: ${context.entityTable}:${context.entityId}
- Title: ${context.entityTitle}
${context.entityDescription ? `- Description: ${context.entityDescription}` : ""}
${context.entityStatus ? `- Status: ${context.entityStatus}` : ""}

## Related Decisions
${decisionsText}

## Deterministic Check Result
- Verdict: ${deterministicVerdict.verdict}
- Text: ${deterministicVerdict.text}

## Instructions
Analyze whether this entity contradicts, aligns with, or has an unclear relationship to the related decisions.
- "mismatch" = clear contradiction between entity and a decision
- "match" = entity aligns with all relevant decisions
- "inconclusive" = insufficient evidence to determine

For evidence_refs, only reference entities listed above using their table:id format.
If you find a contradiction, fill in the contradiction field with specific claim vs reality.
Set confidence based on how clear the evidence is (use <0.5 when ambiguous).`,
      abortSignal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;
    logInfo("observer.llm.call", "LLM verification verdict generated", {
      latencyMs,
      verdict: result.object.verdict,
      confidence: result.object.confidence,
    });

    // Post-validate evidence refs
    const validatedRefs = validateEvidenceRefs(
      result.object.evidence_refs,
      context.validEntityIds,
    );

    return {
      ...result.object,
      evidence_refs: validatedRefs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    logError("observer.llm.error", "LLM verification verdict failed", {
      error,
      latencyMs,
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Peer review verdict
// ---------------------------------------------------------------------------

export async function generatePeerReviewVerdict(
  model: LanguageModel,
  originalText: string,
  originalSeverity: string,
  sourceAgent: string,
  linkedEntities: Array<{ table: string; id: string; title: string; description?: string }>,
): Promise<PeerReviewVerdict | undefined> {
  const start = Date.now();

  try {
    const entitiesText = linkedEntities.length > 0
      ? linkedEntities.map((e) =>
          `- [${e.table}:${e.id}] ${e.title}${e.description ? ` — ${e.description}` : ""}`,
        ).join("\n")
      : "No linked entities.";

    const result = await generateObject({
      model,
      schema: peerReviewVerdictSchema,
      prompt: `You are a peer review agent evaluating whether an observation is well-grounded in evidence.

## Observation Under Review
- Text: "${originalText}"
- Severity: ${originalSeverity}
- Source Agent: ${sourceAgent}

## Cited Evidence (entities linked via observes edges)
${entitiesText}

## Instructions
Evaluate whether the observation's claims are supported by the linked entities.
- "sound" = claims are well-grounded in the evidence (confidence >= 0.7)
- "questionable" = partially supported, some claims lack evidence (confidence 0.4-0.7)
- "unsupported" = claims lack evidence or contradict linked entities (confidence < 0.4)

Base your verdict on whether the evidence actually supports the specific claims made.`,
      abortSignal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;
    logInfo("observer.llm.peer_review", "LLM peer review verdict generated", {
      latencyMs,
      verdict: result.object.verdict,
      confidence: result.object.confidence,
    });

    return result.object;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logError("observer.llm.peer_review_error", "LLM peer review verdict failed", {
      error,
      latencyMs,
    });
    return undefined;
  }
}
