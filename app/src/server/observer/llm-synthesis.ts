/**
 * LLM synthesis: effect boundary for generateObject calls in pattern synthesis pipeline.
 *
 * Takes anomalies from deterministic graph scan and synthesizes named patterns.
 * Uses AbortSignal.timeout(10_000) for latency control.
 * Returns undefined on any failure.
 */

import { generateObject, type LanguageModel } from "ai";
import { logError, logInfo } from "../http/observability";
import { synthesisResultSchema, type SynthesisPattern } from "./schemas";

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
