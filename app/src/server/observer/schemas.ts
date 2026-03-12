/**
 * Zod schemas for LLM structured output in observer reasoning pipelines.
 *
 * Pure module — no IO imports. Schemas constrain generateObject JSON output.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Verification verdict (semantic verification pipeline)
// ---------------------------------------------------------------------------

export const llmVerdictSchema = z.object({
  verdict: z.enum(["match", "mismatch", "inconclusive"]).describe(
    "match = entity aligns with decisions, mismatch = contradiction detected, inconclusive = insufficient evidence",
  ),
  confidence: z.number().min(0).max(1).describe(
    "Confidence in the verdict (0.0-1.0). Use <0.5 when evidence is ambiguous.",
  ),
  reasoning: z.string().describe(
    "Natural language explanation of the verdict. Reference specific entities and decisions.",
  ),
  evidence_refs: z.array(z.string()).describe(
    "Entity references in table:id format (e.g. decision:uuid, task:uuid) that support the verdict. Only include entities you were given in context.",
  ),
  contradiction: z.object({
    claim: z.string().describe("What the entity claims or implements. Use 'none' when verdict is not mismatch."),
    reality: z.string().describe("What the decision or constraint requires. Use 'none' when verdict is not mismatch."),
  }).describe(
    "Describes the specific contradiction. Set both fields to 'none' when verdict is not mismatch.",
  ),
});

/** Parsed verdict with contradiction normalized to undefined when not a mismatch. */
export type LlmVerdict = Omit<z.infer<typeof llmVerdictSchema>, "contradiction"> & {
  contradiction?: { claim: string; reality: string };
};

/** Strip "none" sentinel from contradiction field after parsing. */
export function parseLlmVerdict(raw: z.infer<typeof llmVerdictSchema>): LlmVerdict {
  const { contradiction, ...rest } = raw;
  const isNone = contradiction.claim === "none" && contradiction.reality === "none";
  return isNone ? rest : { ...rest, contradiction };
}

// ---------------------------------------------------------------------------
// Synthesis pattern (pattern synthesis pipeline)
// ---------------------------------------------------------------------------

export const synthesisPatternSchema = z.object({
  pattern_name: z.enum([
    "bottleneck_decision",
    "cascade_block",
    "priority_drift",
    "stale_cluster",
    "contradiction_cluster",
  ]).describe(
    "bottleneck_decision = single decision blocking multiple tasks, cascade_block = chain of blocked items, priority_drift = priorities inconsistent with actions, stale_cluster = group of stale items in same area, contradiction_cluster = multiple contradictions sharing a root cause",
  ),
  description: z.string().describe(
    "Natural language synthesis explaining the pattern and its impact.",
  ),
  contributing_entities: z.array(z.string()).min(2).describe(
    "Entity references in table:id format that contribute to this pattern. Minimum 2 required.",
  ),
  severity: z.enum(["warning", "conflict"]).describe(
    "warning = potential risk, conflict = active contradiction requiring resolution",
  ),
  suggested_action: z.string().describe(
    "Recommended action to address the pattern.",
  ),
});

export type SynthesisPattern = z.infer<typeof synthesisPatternSchema>;

export const synthesisResultSchema = z.object({
  patterns: z.array(synthesisPatternSchema),
});

export type SynthesisResult = z.infer<typeof synthesisResultSchema>;

// ---------------------------------------------------------------------------
// Contradiction detection (graph scan pipeline)
// ---------------------------------------------------------------------------

export const detectedContradictionSchema = z.object({
  decision_ref: z.string().describe(
    "The contradicted decision in table:id format (e.g. decision:uuid). Must match an ID from the provided decisions.",
  ),
  task_ref: z.string().describe(
    "The contradicting task in table:id format (e.g. task:uuid). Must match an ID from the provided tasks.",
  ),
  reasoning: z.string().describe(
    "Concise explanation of why the task contradicts the decision.",
  ),
});

export type DetectedContradiction = z.infer<typeof detectedContradictionSchema>;

export const contradictionDetectionResultSchema = z.object({
  contradictions: z.array(detectedContradictionSchema).describe(
    "Pairs of (decision, task) where a completed task implements an approach that contradicts a confirmed decision. Only include clear contradictions, not minor differences.",
  ),
});

// ---------------------------------------------------------------------------
// Peer review verdict (peer review pipeline)
// ---------------------------------------------------------------------------

export const peerReviewVerdictSchema = z.object({
  verdict: z.enum(["sound", "questionable", "unsupported"]).describe(
    "sound = observation is well-grounded (>=0.7), questionable = partially supported (0.4-0.7), unsupported = lacks evidence (<0.4)",
  ),
  confidence: z.number().min(0).max(1).describe(
    "Confidence in the review verdict (0.0-1.0).",
  ),
  reasoning: z.string().describe(
    "Evidence evaluation explaining why the observation is or isn't well-grounded.",
  ),
});

export type PeerReviewVerdict = z.infer<typeof peerReviewVerdictSchema>;

// ---------------------------------------------------------------------------
// Anomaly evaluation verdict (stale/drift LLM reasoning)
// ---------------------------------------------------------------------------

export const anomalyEvaluationSchema = z.object({
  entity_ref: z.string().describe(
    "The entity in table:id format being evaluated. Must match an entity from the provided list.",
  ),
  relevant: z.boolean().describe(
    "true if this anomaly is genuinely concerning and warrants human attention. false if it is likely expected state, a known external dependency, or otherwise a false positive.",
  ),
  reasoning: z.string().describe(
    "Brief explanation of why this anomaly is or is not relevant. Reference the task title and any contextual clues from the description.",
  ),
  suggested_severity: z.enum(["info", "warning", "conflict"]).describe(
    "info = low concern (expected wait, external dependency). warning = genuine staleness or drift needing review. conflict = actively blocking critical work or contradicting decisions.",
  ),
});

export type AnomalyEvaluation = z.infer<typeof anomalyEvaluationSchema>;

export const anomalyEvaluationResultSchema = z.object({
  evaluations: z.array(anomalyEvaluationSchema),
});

export type AnomalyEvaluationResult = z.infer<typeof anomalyEvaluationResultSchema>;
