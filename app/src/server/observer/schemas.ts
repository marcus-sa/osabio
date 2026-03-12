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
    claim: z.string().describe("What the entity claims or implements"),
    reality: z.string().describe("What the decision or constraint requires"),
  }).optional().describe(
    "Present only when verdict is mismatch. Describes the specific contradiction.",
  ),
});

export type LlmVerdict = z.infer<typeof llmVerdictSchema>;

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
