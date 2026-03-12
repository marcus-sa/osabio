/**
 * LLM synthesis: effect boundary for generateObject calls in pattern synthesis pipeline.
 *
 * Takes anomalies from deterministic graph scan and synthesizes named patterns.
 * Uses AbortSignal.timeout(10_000) for latency control.
 * Returns undefined on any failure.
 */

import { generateObject, type LanguageModel } from "ai";
import { logError, logInfo } from "../http/observability";
import { anomalyEvaluationResultSchema, contradictionDetectionResultSchema, synthesisResultSchema, type AnomalyEvaluation, type DetectedContradiction, type SynthesisPattern } from "./schemas";
import { OBSERVER_IDENTITY } from "../agents/observer/prompt";

export type Anomaly = {
  type: "contradiction" | "stale_blocked" | "status_drift";
  text: string;
  entityId: string;
  entityTable: string;
};

/**
 * Synthesizes anomalies into named patterns via LLM.
 * Returns patterns with min 2 contributing entities, or undefined on failure.
 */
export async function synthesizePatterns(
  model: LanguageModel,
  anomalies: Anomaly[],
): Promise<SynthesisPattern[] | undefined> {
  if (anomalies.length === 0) return [];

  const start = Date.now();

  // Partition large workspaces: top 20 per type
  const partitioned = partitionAnomalies(anomalies, 20);

  try {
    const anomaliesText = partitioned.map((a) =>
      `- [${a.entityTable}:${a.entityId}] (${a.type}) ${a.text}`,
    ).join("\n");

    const result = await generateObject({
      model,
      schema: synthesisResultSchema,
      prompt: `You are a pattern synthesis agent analyzing workspace anomalies to identify systemic patterns.

## Anomalies Detected
${anomaliesText}

## Instructions
Analyze these anomalies and identify higher-level patterns:
- "bottleneck_decision" = single decision blocking multiple tasks
- "cascade_block" = chain of blocked items
- "priority_drift" = priorities inconsistent with actions
- "stale_cluster" = group of stale items in same area
- "contradiction_cluster" = multiple contradictions sharing a root cause

Rules:
- Each pattern MUST reference at least 2 contributing entities using table:id format
- Only include entities from the anomalies listed above
- If no meaningful patterns emerge, return an empty patterns array
- Set severity to "conflict" only for active contradictions`,
      abortSignal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;
    logInfo("observer.llm.synthesis", "LLM pattern synthesis completed", {
      latencyMs,
      patternCount: result.object.patterns.length,
    });

    // Filter patterns with < 2 contributing entities (schema enforces min 2, but defense in depth)
    return result.object.patterns.filter((p) => p.contributing_entities.length >= 2);
  } catch (error) {
    const latencyMs = Date.now() - start;
    logError("observer.llm.synthesis_error", "LLM pattern synthesis failed", {
      error,
      latencyMs,
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Contradiction detection (LLM-based)
// ---------------------------------------------------------------------------

export type DecisionInput = {
  id: string;
  summary: string;
  rationale?: string;
};

export type TaskInput = {
  id: string;
  title: string;
  description?: string;
};

/**
 * Detects contradictions between confirmed decisions and completed tasks via LLM.
 * Returns detected contradiction pairs, or undefined on failure.
 */
export async function detectContradictions(
  model: LanguageModel,
  decisions: DecisionInput[],
  tasks: TaskInput[],
): Promise<DetectedContradiction[] | undefined> {
  if (decisions.length === 0 || tasks.length === 0) return [];

  const start = Date.now();

  try {
    const decisionsText = decisions.map((d) =>
      `- [decision:${d.id}] ${d.summary}${d.rationale ? ` (rationale: ${d.rationale})` : ""}`,
    ).join("\n");

    const tasksText = tasks.map((t) =>
      `- [task:${t.id}] ${t.title}${t.description ? ` — ${t.description}` : ""}`,
    ).join("\n");

    const result = await generateObject({
      model,
      schema: contradictionDetectionResultSchema,
      prompt: `You are an observer agent scanning a workspace knowledge graph for contradictions between confirmed decisions and completed tasks.

## Confirmed Decisions
${decisionsText}

## Completed Tasks
${tasksText}

## Instructions
Identify any completed task that contradicts a confirmed decision. A contradiction means the task implements an approach that directly conflicts with what the decision mandates.

Examples of contradictions:
- Decision mandates tRPC but task implements REST endpoints
- Decision requires TypeScript but task delivers JavaScript
- Decision specifies PostgreSQL but task sets up MongoDB
- Decision requires feature flags but task ships without them

Rules:
- Only flag clear, direct contradictions — not minor implementation variations
- Use the exact table:id format from the lists above for decision_ref and task_ref
- If no contradictions exist, return an empty array`,
      abortSignal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;
    logInfo("observer.llm.contradiction_detection", "LLM contradiction detection completed", {
      latencyMs,
      contradictionCount: result.object.contradictions.length,
    });

    return result.object.contradictions;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logError("observer.llm.contradiction_detection_error", "LLM contradiction detection failed", {
      error,
      latencyMs,
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Anomaly evaluation (LLM-based relevance filtering for stale/drift)
// ---------------------------------------------------------------------------

export type AnomalyCandidate = {
  entityRef: string;
  type: "stale_blocked" | "status_drift";
  title: string;
  description?: string;
  detail: string;
};

/**
 * Evaluates stale/drift anomaly candidates via LLM to filter false positives.
 * Returns per-entity evaluations with relevance verdict, reasoning, and severity.
 * Returns undefined on failure (caller falls back to creating all observations).
 */
export async function evaluateAnomalies(
  model: LanguageModel,
  candidates: AnomalyCandidate[],
): Promise<AnomalyEvaluation[] | undefined> {
  if (candidates.length === 0) return [];

  const start = Date.now();

  try {
    const candidatesText = candidates.map((c) =>
      `- [${c.entityRef}] (${c.type}) "${c.title}"${c.description ? ` — ${c.description}` : ""}\n  Detail: ${c.detail}`,
    ).join("\n");

    const result = await generateObject({
      model,
      system: OBSERVER_IDENTITY,
      schema: anomalyEvaluationResultSchema,
      prompt: `You are evaluating workspace anomalies to determine which ones genuinely warrant human attention and which are likely false positives.

## Anomaly Candidates
${candidatesText}

## Instructions
For each anomaly, evaluate whether it is genuinely concerning:

**stale_blocked** — A task has been in "blocked" status for over 14 days.
- Mark as NOT relevant if the title/description suggests an expected external wait (e.g., "waiting on vendor", "pending legal review", "blocked by external API release").
- Mark as relevant if the task appears to be forgotten, lacks clear reason for blockage, or suggests internal coordination failure.
- Use "conflict" severity only when the blocked task is clearly critical or blocking other work.

**status_drift** — A task is marked completed but has incomplete dependencies.
- Mark as NOT relevant if the dependency is optional, informational, or the task could reasonably be done out of order.
- Mark as relevant if the dependency is clearly prerequisite work that should have been done first.
- Use "conflict" severity when the drift could mean the completed task is actually broken.

Return an evaluation for EVERY candidate. Use the exact entity_ref from the list above.`,
      abortSignal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Date.now() - start;
    const relevantCount = result.object.evaluations.filter((e) => e.relevant).length;
    logInfo("observer.llm.anomaly_evaluation", "LLM anomaly evaluation completed", {
      latencyMs,
      candidateCount: candidates.length,
      relevantCount,
      filteredCount: candidates.length - relevantCount,
    });

    return result.object.evaluations;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logError("observer.llm.anomaly_evaluation_error", "LLM anomaly evaluation failed", {
      error,
      latencyMs,
    });
    return undefined;
  }
}

/**
 * Partitions anomalies by type and takes top N per type to manage LLM context size.
 */
function partitionAnomalies(anomalies: Anomaly[], maxPerType: number): Anomaly[] {
  if (anomalies.length <= maxPerType * 3) return anomalies;

  const byType = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  const result: Anomaly[] = [];
  for (const [, list] of byType) {
    result.push(...list.slice(0, maxPerType));
  }
  return result;
}
