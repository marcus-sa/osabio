/**
 * LLM reasoning: effect boundary for generateObject calls in verification pipeline.
 *
 * Each function makes a single LLM call with structured output schema.
 * All calls use AbortSignal.timeout(10_000) for latency control.
 * Returns undefined on any failure (timeout, rate limit, invalid output).
 */

import { generateObject, type LanguageModel } from "ai";
import { logError, logInfo } from "../http/observability";
import { llmVerdictSchema, parseLlmVerdict, peerReviewVerdictSchema, type LlmVerdict, type PeerReviewVerdict } from "./schemas";
import { validateEvidenceRefs } from "./evidence-validator";
import type { EntityContext } from "./context-loader";
import type { VerificationResult } from "./verification-pipeline";
import { OBSERVER_IDENTITY } from "../agents/observer/prompt";

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
      system: OBSERVER_IDENTITY,
      schema: llmVerdictSchema,
      prompt: `Verify whether this entity aligns with or contradicts the confirmed decisions in its project.

## Entity Under Review
- Type: ${context.entityTable}
- ID: ${context.entityTable}:${context.entityId}
- Title: ${context.entityTitle}
${context.entityDescription ? `- Description: ${context.entityDescription}` : ""}
${context.entityStatus ? `- Status: ${context.entityStatus}` : ""}

## Confirmed Decisions in Same Project
${decisionsText}

## Deterministic Check Result
- Verdict: ${deterministicVerdict.verdict}
- Text: ${deterministicVerdict.text}

## Instructions
Compare the entity's title and description against each decision's summary and rationale.
- "mismatch" = the entity does something a decision explicitly forbids or rules out. Be specific about which decision.
- "match" = the entity's approach is consistent with all decisions.
- "inconclusive" = decisions don't address what the entity does, or evidence is genuinely ambiguous.

In evidence_refs, list the table:id of every entity and decision relevant to your verdict.
In contradiction.claim, state what the entity does. In contradiction.reality, state what the decision requires. Set both to "none" when verdict is not mismatch.
Set confidence >= 0.7 when evidence clearly supports your verdict. Use < 0.5 only when genuinely ambiguous.`,
      abortSignal: AbortSignal.timeout(30_000),
    });

    const latencyMs = Date.now() - start;
    logInfo("observer.llm.call", "LLM verification verdict generated", {
      latencyMs,
      verdict: result.object.verdict,
      confidence: result.object.confidence,
    });

    const parsed = parseLlmVerdict(result.object);

    // Post-validate evidence refs
    const validatedRefs = validateEvidenceRefs(
      parsed.evidence_refs,
      context.validEntityIds,
    );

    return {
      ...parsed,
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
      system: OBSERVER_IDENTITY,
      schema: peerReviewVerdictSchema,
      prompt: `Peer-review this observation from another agent. Evaluate whether its claims are grounded in the cited evidence.

## Observation Under Review
- Text: "${originalText}"
- Severity: ${originalSeverity}
- Source Agent: ${sourceAgent}

## Cited Evidence (entities linked via observes edges)
${entitiesText}

## Instructions
- "sound" (confidence >= 0.7) = linked entities directly support the claims.
- "questionable" (confidence 0.4-0.7) = partial support, some claims go beyond the evidence.
- "unsupported" (confidence < 0.4) = claims lack evidence or contradict linked entities.

If no entities are linked, the observation has no cited evidence — verdict should be "unsupported" with low confidence.`,
      abortSignal: AbortSignal.timeout(30_000),
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
