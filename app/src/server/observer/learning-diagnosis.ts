/**
 * Learning Diagnosis: Observation Clustering, Root Cause Classification, and Learning Proposals
 *
 * Groups open observations by embedding similarity into clusters,
 * checks if active learnings already cover each cluster pattern,
 * classifies root causes via LLM structured output, and proposes learnings.
 *
 * Pure query functions + pipeline composition. IO at boundaries only.
 *
 * Step 01-01: Clustering + coverage check
 * Step 01-02: Root cause classification with LLM structured output
 * Step 01-03: Learning proposer + graph scan integration
 */

import { RecordId, type Surreal } from "surrealdb";
import { generateObject, type LanguageModel } from "ai";
import { rootCauseSchema, type RootCauseClassification } from "./schemas";
import { OBSERVER_IDENTITY } from "../agents/observer/prompt";
import { extractSearchTerms } from "../graph/bm25-search";
import { createTelemetryConfig, recordLlmMetrics, recordLlmError } from "../telemetry/ai-telemetry";
import { FUNCTION_IDS } from "../telemetry/function-ids";
import { checkRateLimit, suggestLearning } from "../learning/detector";
import { createObservation } from "../observation/queries";
import { buildCoverageQuery, isCoverageMatch, type Bm25LearningMatch } from "../learning/bm25-collision";
import { analyzeTrend, type ScorePoint, type TrendPattern, type TrendResult } from "../behavior/trends";
import type { CreateLearningInput } from "../learning/types";
import type { CoverageCheckResult } from "../learning/collision-types";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationForClustering = {
  id: string;
  text: string;
  severity: string;
  entityRefs: string[];
};

export type Bm25SimilarityEdge = {
  sourceId: string;
  matchId: string;
  score: number;
};

export type ObservationCluster = {
  observations: Array<{ id: string; text: string; severity: string; entityRefs: string[] }>;
  representativeText: string;
  clusterSize: number;
};

export type { CoverageCheckResult } from "../learning/collision-types";

export type DiagnosticResult = {
  learning_proposals_created: number;
  coverage_skips: number;
  clusters_found: number;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MINIMUM_CLUSTER_SIZE = 3;
const TIME_WINDOW_DAYS = 14;
// Coverage and dismissed similarity thresholds are no longer needed --
// BM25 fulltext search handles relevance filtering via the @N@ match operator.

// ---------------------------------------------------------------------------
// Observation query (IO boundary) -- embedding-free BM25 path
// ---------------------------------------------------------------------------

/**
 * Queries open/acknowledged observations from the past 14 days.
 * Does NOT require embeddings -- observations are clustered via BM25 text search.
 */
export async function queryRecentObservations(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ObservationForClustering[]> {
  const cutoff = new Date(Date.now() - TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [rows] = await surreal.query<[Array<{
    id: RecordId<"observation">;
    text: string;
    severity: string;
    entity_refs: Array<RecordId | string>;
    created_at: string;
  }>]>(
    `SELECT id, text, severity, created_at,
            ->observes->task.id AS entity_refs
     FROM observation
     WHERE workspace = $ws
       AND status IN ["open", "acknowledged"]
       AND created_at > $cutoff
     ORDER BY created_at DESC
     LIMIT 200;`,
    { ws: workspaceRecord, cutoff },
  );

  return (rows ?? []).map((row) => ({
    id: row.id.id as string,
    text: row.text,
    severity: row.severity,
    entityRefs: (row.entity_refs ?? [])
      .filter((ref): ref is RecordId => typeof ref === "object" && ref !== null && "id" in ref)
      .map((ref) => `task:${ref.id as string}`),
  }));
}

// ---------------------------------------------------------------------------
// BM25 observation similarity query builder (pure -- no IO)
// ---------------------------------------------------------------------------

/**
 * Builds a BM25 fulltext search query using OR-predicate pattern.
 *
 * Each term gets its own predicate number so SurrealDB matches ANY term
 * (OR semantics) instead of requiring ALL terms (AND semantics of single @N@).
 *
 * Returns { sql, bindings } where bindings include $ws and $t0..$tN.
 */
export function buildObservationSimilarityOrQuery(
  termList: string[],
  workspaceRecord: RecordId<"workspace", string>,
): { sql: string; bindings: Record<string, unknown> } {
  const matchClause = termList.map((_, i) => `text @${i}@ $t${i}`).join(" OR ");
  const scoreExpr = termList.map((_, i) => `search::score(${i})`).join(" + ");
  const bindings: Record<string, unknown> = { ws: workspaceRecord };
  termList.forEach((term, i) => { bindings[`t${i}`] = term; });

  const sql = [
    `SELECT id, text, ${scoreExpr} AS score`,
    `FROM observation`,
    `WHERE (${matchClause})`,
    `AND workspace = $ws`,
    `AND status IN ["open", "acknowledged"]`,
    `ORDER BY score DESC`,
    `LIMIT 10;`,
  ].join("\n");

  return { sql, bindings };
}

// Re-export from shared module for existing callers
export { extractSearchTerms } from "../graph/bm25-search";

// ---------------------------------------------------------------------------
// BM25-based clustering (IO boundary for queries, pure for grouping)
// ---------------------------------------------------------------------------

/**
 * Clusters observations by BM25 text similarity.
 *
 * For each observation, performs a BM25 fulltext search to find similar observations.
 * Builds a similarity edge graph, then groups via BFS connected components.
 * Self-matches are filtered in application code (SurrealDB id != $self is unreliable
 * when combined with BM25 @N@ operator).
 *
 * IO boundary: executes BM25 queries against SurrealDB.
 */
export async function clusterObservationsByBm25(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  observations: ObservationForClustering[],
  minimumClusterSize: number = MINIMUM_CLUSTER_SIZE,
): Promise<ObservationCluster[]> {
  if (observations.length < minimumClusterSize) return [];

  // Build similarity edges via BM25 for each observation
  const edges: Bm25SimilarityEdge[] = [];
  const observationIds = new Set(observations.map((o) => o.id));

  for (const obs of observations) {
    const termList = extractSearchTerms(obs.text).split(" ").filter((t) => t.length > 0);
    if (termList.length === 0) continue;
    const { sql, bindings } = buildObservationSimilarityOrQuery(termList, workspaceRecord);
    const [matches] = await surreal.query<[Array<{
      id: RecordId<"observation">;
      text: string;
      score: number;
    }>]>(sql, bindings);

    for (const match of matches ?? []) {
      const matchId = match.id.id as string;
      // Filter out self-match in application code and limit to our observation set
      if (matchId !== obs.id && observationIds.has(matchId)) {
        edges.push({
          sourceId: obs.id,
          matchId,
          score: match.score,
        });
      }
    }
  }

  return groupObservationsIntoClusters(observations, edges, minimumClusterSize);
}

// ---------------------------------------------------------------------------
// Pure clustering from BM25 edges (no IO)
// ---------------------------------------------------------------------------

/**
 * Groups observations into clusters using BFS on BM25 similarity edges.
 *
 * Algorithm:
 * 1. Build adjacency graph from BM25 edges (bidirectional)
 * 2. Find connected components via BFS
 * 3. Filter by minimum cluster size
 * 4. Pick representative as the observation with highest total BM25 score
 *
 * Pure function -- no IO.
 */
export function groupObservationsIntoClusters(
  observations: ObservationForClustering[],
  edges: Bm25SimilarityEdge[],
  minimumClusterSize: number = MINIMUM_CLUSTER_SIZE,
): ObservationCluster[] {
  if (observations.length < minimumClusterSize) return [];

  const idToIndex = new Map<string, number>();
  for (let i = 0; i < observations.length; i++) {
    idToIndex.set(observations[i].id, i);
  }

  // Build bidirectional adjacency from edges
  const adjacency = new Map<number, Set<number>>();
  for (let i = 0; i < observations.length; i++) {
    adjacency.set(i, new Set());
  }

  // Track total BM25 scores per observation for representative selection
  const totalScores = new Map<number, number>();
  for (let i = 0; i < observations.length; i++) {
    totalScores.set(i, 0);
  }

  for (const edge of edges) {
    const sourceIdx = idToIndex.get(edge.sourceId);
    const matchIdx = idToIndex.get(edge.matchId);
    if (sourceIdx !== undefined && matchIdx !== undefined && sourceIdx !== matchIdx) {
      adjacency.get(sourceIdx)!.add(matchIdx);
      adjacency.get(matchIdx)!.add(sourceIdx);
      totalScores.set(sourceIdx, (totalScores.get(sourceIdx) ?? 0) + edge.score);
      totalScores.set(matchIdx, (totalScores.get(matchIdx) ?? 0) + edge.score);
    }
  }

  // BFS to find connected components
  const visited = new Set<number>();
  const clusters: ObservationCluster[] = [];

  for (let i = 0; i < observations.length; i++) {
    if (visited.has(i)) continue;
    if (adjacency.get(i)!.size === 0) {
      visited.add(i);
      continue;
    }

    const component: number[] = [];
    const queue = [i];
    visited.add(i);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.length >= minimumClusterSize) {
      const clusterObservations = component.map((idx) => ({
        id: observations[idx].id,
        text: observations[idx].text,
        severity: observations[idx].severity,
        entityRefs: observations[idx].entityRefs,
      }));

      // Representative: observation with highest total BM25 score in cluster
      const representativeIndex = pickRepresentativeByBm25Score(component, totalScores);

      clusters.push({
        observations: clusterObservations,
        representativeText: observations[representativeIndex].text,
        clusterSize: component.length,
      });
    }
  }

  return clusters;
}

/**
 * Picks the observation with highest total BM25 score among cluster members.
 * Pure function -- no IO.
 */
function pickRepresentativeByBm25Score(
  componentIndices: number[],
  totalScores: Map<number, number>,
): number {
  let bestIndex = componentIndices[0];
  let bestScore = -1;

  for (const i of componentIndices) {
    const score = totalScores.get(i) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// ---------------------------------------------------------------------------
// Coverage check (IO boundary -- BM25 fulltext search)
// ---------------------------------------------------------------------------

/**
 * Checks if any learning with a given status covers the cluster pattern.
 * Uses BM25 fulltext search instead of KNN embedding similarity.
 */
async function checkLearningCoverageBm25(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  representativeText: string,
  learningStatus: "active" | "dismissed",
): Promise<CoverageCheckResult> {
  // SurrealDB BM25 @N@ does AND matching — all query terms must exist in the
  // target document. Observation text often contains terms absent from learnings
  // (e.g. "failure" in observation but not in a learning about "pipeline health").
  // Search with individual key terms and take the best match across all queries.
  const termList = extractSearchTerms(representativeText)
    .split(" ")
    .filter((t) => t.length > 0);
  if (termList.length === 0) return { covered: false };

  const allMatches: Bm25LearningMatch[] = [];
  const sql = buildCoverageQuery(learningStatus);
  for (const term of termList) {
    const [rows] = await surreal.query<[Bm25LearningMatch[]]>(sql, {
      ws: workspaceRecord,
      query: term,
    });
    for (const row of rows ?? []) {
      allMatches.push(row);
    }
  }

  // Deduplicate by text (same learning may match multiple terms)
  const seen = new Set<string>();
  const deduped = allMatches.filter((m) => {
    if (seen.has(m.text)) return false;
    seen.add(m.text);
    return true;
  });

  if (learningStatus === "active") {
    log.info("observer.learning.bm25_coverage_check", "BM25 coverage check against active learnings", {
      matchCount: deduped.length,
      topScore: deduped[0]?.score,
      workspaceId: workspaceRecord.id,
      termsSearched: termList.length,
    });
  }

  return isCoverageMatch(deduped);
}

export async function checkCoverageAgainstActiveLearnings(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  representativeText: string,
): Promise<CoverageCheckResult> {
  return checkLearningCoverageBm25(surreal, workspaceRecord, representativeText, "active");
}

export async function checkDismissedLearningForCluster(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  representativeText: string,
): Promise<CoverageCheckResult> {
  return checkLearningCoverageBm25(surreal, workspaceRecord, representativeText, "dismissed");
}

// ---------------------------------------------------------------------------
// Root cause classification (LLM structured output)
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.70;
const CLASSIFICATION_TIMEOUT_MS = 30_000;

/**
 * Builds the LLM prompt for root cause classification.
 * Pure function -- formats cluster and context into prompt text.
 */
function buildClassificationPrompt(
  cluster: ObservationCluster,
  existingLearnings: string[],
): string {
  const observationQuotes = cluster.observations
    .map((obs, i) => `  ${i + 1}. [${obs.severity}] "${obs.text}"`)
    .join("\n");

  const entityRefsList = [
    ...new Set(cluster.observations.flatMap((obs) => obs.entityRefs)),
  ];
  const entityRefsText = entityRefsList.length > 0
    ? entityRefsList.map((ref) => `  - ${ref}`).join("\n")
    : "  No linked entities.";

  const learningsText = existingLearnings.length > 0
    ? existingLearnings.map((l, i) => `  ${i + 1}. ${l}`).join("\n")
    : "  No active learnings.";

  return `You are performing root cause analysis on a recurring pattern detected in the workspace.

## Pattern Detected
Representative text: "${cluster.representativeText}"

Observation quotes (${cluster.clusterSize} occurrences):
${observationQuotes}

## Related Entities
${entityRefsText}

## Existing Active Learnings
${learningsText}

## Classification Instructions
Determine WHY this pattern keeps recurring:

1. Policy Failure: The governance rules allowed something they shouldn't.
   -> Propose a constraint that tightens the boundary.

2. Context Failure: The agent lacked information it needed to act correctly.
   -> Propose an instruction that injects the missing context.

3. Behavioral Drift: The agent had the information but didn't apply it.
   -> Propose a constraint that reinforces the expected behavior.

Set should_propose_learning to true ONLY if:
- confidence >= 0.70
- You have high conviction in both the category AND the proposed text
- The proposed learning is specific enough to be actionable

Set should_propose_learning to false if:
- The root cause is ambiguous or could fit multiple categories
- The proposed learning text is too generic ("be more careful")
- The evidence is insufficient to justify a permanent behavioral rule

For proposed_learning_type, choose based on the fix needed:
- "constraint" for must-follow rules (policy fixes, behavioral reinforcement)
- "instruction" for conditional guidance (context injection, situational awareness)

In evidence_refs, list the observation IDs in table:id format (e.g. observation:uuid).
In target_agents, list the agent types that should receive this learning.`;
}

/**
 * Classifies the root cause of an observation cluster using LLM structured output.
 * Returns undefined on any failure (timeout, rate limit, invalid output).
 */
export async function classifyRootCause(
  model: LanguageModel,
  cluster: ObservationCluster,
  existingLearnings: string[],
): Promise<RootCauseClassification | undefined> {
  const start = Date.now();

  try {
    const prompt = buildClassificationPrompt(cluster, existingLearnings);

    const result = await generateObject({
      model,
      system: OBSERVER_IDENTITY,
      schema: rootCauseSchema,
      experimental_telemetry: createTelemetryConfig(FUNCTION_IDS.OBSERVER_LEARNING_DIAGNOSIS),
      prompt,
      abortSignal: AbortSignal.timeout(CLASSIFICATION_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;
    recordLlmMetrics(FUNCTION_IDS.OBSERVER_LEARNING_DIAGNOSIS, result.usage, latencyMs);
    log.info("observer.llm.root_cause", "Root cause classification completed", {
      latencyMs,
      category: result.object.category,
      confidence: result.object.confidence,
      shouldPropose: result.object.should_propose_learning,
    });

    return result.object;
  } catch (error) {
    const latencyMs = Date.now() - start;
    recordLlmError(FUNCTION_IDS.OBSERVER_LEARNING_DIAGNOSIS, error instanceof Error ? error.constructor.name : "unknown");
    log.error("observer.llm.root_cause_error", "Root cause classification failed", {
      error,
      latencyMs,
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Dual gate: decide whether to propose learning or create observation
// ---------------------------------------------------------------------------

/**
 * Applies the dual gate: should_propose_learning AND confidence >= threshold.
 */
function shouldProposeLearning(classification: RootCauseClassification): boolean {
  return classification.should_propose_learning && classification.confidence >= CONFIDENCE_THRESHOLD;
}

/**
 * Maps a root cause classification to a CreateLearningInput.
 */
function rootCauseToLearningInput(
  classification: RootCauseClassification,
  cluster: ObservationCluster,
): CreateLearningInput {
  return {
    text: classification.proposed_learning_text,
    learningType: classification.proposed_learning_type,
    source: "agent",
    suggestedBy: "observer",
    patternConfidence: classification.confidence,
    targetAgents: classification.target_agents,
    evidenceIds: cluster.observations.map((obs) => ({
      table: "observation" as const,
      id: obs.id,
    })),
  };
}

// ---------------------------------------------------------------------------
// Query existing active learnings for classification context
// ---------------------------------------------------------------------------

async function queryActiveLearningTexts(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<string[]> {
  const [rows] = await surreal.query<[Array<{ text: string; created_at: string }>]>(
    `SELECT text, created_at FROM learning
     WHERE workspace = $ws AND status = "active"
     ORDER BY created_at DESC
     LIMIT 20;`,
    { ws: workspaceRecord },
  );
  return (rows ?? []).map((r) => r.text);
}

// ---------------------------------------------------------------------------
// Behavior Learning Bridge
// ---------------------------------------------------------------------------

export type BehaviorTrendEntry = {
  identityId: string;
  metricType: string;
  trend: TrendResult;
  behaviorIds: string[];
  scorePoints: ScorePoint[];
};

export type ProposeBehaviorLearningInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  identityId: string;
  metricType: string;
  behaviorIds: string[];
  trendPattern: TrendPattern;
  now: Date;
};

export type ProposeBehaviorLearningResult =
  | { created: true; learningRecord: RecordId<"learning", string> }
  | { created: false; reason: "rate_limited"; count: number }
  | { created: false; reason: "dismissed_similarity"; matchedText: string };

/**
 * Queries all behavior records in a workspace, groups by identity + metric type,
 * and analyzes trends for each group.
 *
 * Returns only groups with enough data points for trend analysis.
 */
export async function queryWorkspaceBehaviorTrends(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<BehaviorTrendEntry[]> {
  // Query all behavior records with their identity via exhibits edges
  const [rows] = await surreal.query<[Array<{
    id: RecordId<"behavior">;
    metric_type: string;
    score: number;
    created_at: string;
    identity_id: RecordId<"identity">[];
  }>]>(
    `SELECT id, metric_type, score, created_at,
            <-exhibits<-identity.id AS identity_id
     FROM behavior
     WHERE workspace = $ws
     ORDER BY created_at ASC;`,
    { ws: workspaceRecord },
  );

  if (!rows || rows.length === 0) return [];

  // Group by identity + metric_type
  const groups = new Map<string, {
    identityId: string;
    metricType: string;
    points: ScorePoint[];
    behaviorIds: string[];
  }>();

  for (const row of rows) {
    const identityIds = row.identity_id ?? [];
    if (identityIds.length === 0) continue;

    const identityId = identityIds[0].id as string;
    const key = `${identityId}::${row.metric_type}`;

    if (!groups.has(key)) {
      groups.set(key, {
        identityId,
        metricType: row.metric_type,
        points: [],
        behaviorIds: [],
      });
    }

    const group = groups.get(key)!;
    group.points.push({ score: row.score, timestamp: row.created_at });
    group.behaviorIds.push(row.id.id as string);
  }

  // Analyze trend for each group
  const entries: BehaviorTrendEntry[] = [];
  for (const group of groups.values()) {
    const trend = analyzeTrend(group.points);
    entries.push({
      identityId: group.identityId,
      metricType: group.metricType,
      trend,
      behaviorIds: group.behaviorIds,
      scorePoints: group.points,
    });
  }

  return entries;
}

/**
 * Rate limit guard for behavior-sourced learning proposals.
 * Returns early if >= 5 observer proposals exist in the past 7 days.
 */
export async function checkBehaviorLearningRateLimit(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<{ blocked: boolean; count: number }> {
  return checkRateLimit({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    agentType: "observer",
  });
}

/**
 * Composes a learning proposal from behavior trend data and submits it
 * via the existing suggestLearning pipeline (with rate limit + collision detection).
 *
 * Behavior records are linked as learning_evidence via the extended relation OUT.
 */
export async function proposeBehaviorLearning(
  input: ProposeBehaviorLearningInput,
): Promise<ProposeBehaviorLearningResult> {
  const learningText = buildBehaviorLearningText(
    input.identityId,
    input.metricType,
    input.trendPattern,
  );

  const learningInput: CreateLearningInput = {
    text: learningText,
    learningType: "constraint",
    source: "agent",
    suggestedBy: "observer",
    patternConfidence: 0.80,
    targetAgents: [input.identityId],
    evidenceIds: input.behaviorIds.map((id) => ({
      table: "behavior" as const,
      id,
    })),
  };

  const result = await suggestLearning({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    learning: learningInput,
    now: input.now,
  });

  if (result.created) {
    log.info("observer.behavior.learning_proposed", "Learning proposed from behavior trend", {
      identityId: input.identityId,
      metricType: input.metricType,
      trendPattern: input.trendPattern,
      learningId: result.learningRecord.id,
    });
    return { created: true, learningRecord: result.learningRecord };
  }

  log.info("observer.behavior.learning_blocked", "Behavior learning proposal blocked", {
    identityId: input.identityId,
    metricType: input.metricType,
    reason: result.reason,
  });

  return result;
}

/**
 * Builds a descriptive learning text from behavior trend data.
 * Pure function -- no IO.
 */
function buildBehaviorLearningText(
  identityId: string,
  metricType: string,
  trendPattern: TrendPattern,
): string {
  const metricLabel = metricType.replace(/_/g, " ");

  switch (trendPattern) {
    case "drift":
      return `Agent ${identityId} shows sustained decline in ${metricLabel}. ` +
        `Enforce ${metricLabel} standards before proceeding with other work.`;
    case "flat":
      return `Agent ${identityId} shows persistent stagnation in ${metricLabel} below threshold. ` +
        `Current learning interventions for ${metricLabel} are ineffective -- consider revising approach.`;
    default:
      return `Agent ${identityId} shows concerning ${trendPattern} pattern in ${metricLabel}. ` +
        `Review ${metricLabel} compliance and reinforce expected behavior.`;
  }
}

// ---------------------------------------------------------------------------
// Process a single uncovered cluster: classify and propose or observe
// ---------------------------------------------------------------------------

async function processUncoveredCluster(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  model: LanguageModel,
  cluster: ObservationCluster,
  existingLearnings: string[],
): Promise<{ proposed: boolean }> {
  const classification = await classifyRootCause(model, cluster, existingLearnings);

  if (!classification) {
    log.info("observer.learning.classification_skipped", "Skipping cluster due to failed LLM classification", {
      clusterSize: cluster.clusterSize,
      representativeText: cluster.representativeText.slice(0, 100),
    });
    return { proposed: false };
  }

  if (shouldProposeLearning(classification)) {
    const learningInput = rootCauseToLearningInput(classification, cluster);

    // BM25 dismissed similarity gate runs inside suggestLearning -- no embedding needed
    const result = await suggestLearning({
      surreal,
      workspaceRecord,
      learning: learningInput,
      now: new Date(),
    });

    if (result.created) {
      log.info("observer.learning.proposed", "Learning proposed from root cause analysis", {
        category: classification.category,
        confidence: classification.confidence,
        learningType: classification.proposed_learning_type,
        learningId: result.learningRecord.id,
      });
      return { proposed: true };
    }

    log.info("observer.learning.gate_blocked", "Learning proposal blocked by safety gate", {
      reason: result.reason,
    });
    return { proposed: false };
  }

  // Dual gate failed: create an observation instead
  await createObservation({
    surreal,
    workspaceRecord,
    text: `Emerging pattern detected but root cause unclear (${classification.category}, confidence: ${classification.confidence.toFixed(2)}): ${classification.reasoning}`,
    severity: "info",
    sourceAgent: "observer_agent",
    observationType: "pattern",
    now: new Date(),
  });

  log.info("observer.learning.low_confidence", "Pattern observed but confidence too low for learning proposal", {
    category: classification.category,
    confidence: classification.confidence,
    shouldPropose: classification.should_propose_learning,
  });

  return { proposed: false };
}

// ---------------------------------------------------------------------------
// Diagnostic pipeline orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the observation clustering, coverage check, and root cause classification pipeline.
 *
 * Pipeline:
 * 1. Query recent observations (no embeddings required)
 * 2. Cluster by BM25 text similarity
 * 3. For each cluster, check coverage against active learnings
 * 4. For uncovered clusters, classify root cause via LLM
 * 5. Propose learning or create observation based on dual gate
 */
export async function runDiagnosticClustering(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  observerModel: LanguageModel,
): Promise<{
  clusters: ObservationCluster[];
  uncoveredClusters: ObservationCluster[];
  result: DiagnosticResult;
}> {
  const diagnosticResult: DiagnosticResult = {
    learning_proposals_created: 0,
    coverage_skips: 0,
    clusters_found: 0,
  };

  // Step 1: Query recent observations (no embeddings needed)
  const observations = await queryRecentObservations(
    surreal,
    workspaceRecord,
  );

  if (observations.length < MINIMUM_CLUSTER_SIZE) {
    return { clusters: [], uncoveredClusters: [], result: diagnosticResult };
  }

  // Step 2: Cluster by BM25 text similarity
  const clusters = await clusterObservationsByBm25(surreal, workspaceRecord, observations);
  diagnosticResult.clusters_found = clusters.length;

  if (clusters.length === 0) {
    return { clusters: [], uncoveredClusters: [], result: diagnosticResult };
  }

  // Step 3: Coverage check for each cluster (BM25 on representative text)
  const uncoveredClusters: ObservationCluster[] = [];

  for (const cluster of clusters) {
    const coverage = await checkCoverageAgainstActiveLearnings(
      surreal,
      workspaceRecord,
      cluster.representativeText,
    );

    if (coverage.covered) {
      log.info("observer.learning.coverage_skip", "Cluster pattern already covered by active learning", {
        clusterSize: cluster.clusterSize,
        matchedLearningText: coverage.matchedLearningText,
        score: coverage.score,
      });
      diagnosticResult.coverage_skips += 1;
      continue;
    }

    // Check if a dismissed learning already covers this pattern
    const dismissedCheck = await checkDismissedLearningForCluster(
      surreal,
      workspaceRecord,
      cluster.representativeText,
    );

    if (dismissedCheck.covered) {
      log.info("observer.learning.dismissed_skip", "Cluster pattern matches a previously dismissed learning", {
        clusterSize: cluster.clusterSize,
        matchedLearningText: dismissedCheck.matchedLearningText,
        score: dismissedCheck.score,
      });
      diagnosticResult.coverage_skips += 1;
    } else {
      uncoveredClusters.push(cluster);
    }
  }

  // Step 4: Root cause classification for uncovered clusters
  if (uncoveredClusters.length > 0) {
    const existingLearnings = await queryActiveLearningTexts(surreal, workspaceRecord);

    for (const cluster of uncoveredClusters) {
      const { proposed } = await processUncoveredCluster(
        surreal,
        workspaceRecord,
        observerModel,
        cluster,
        existingLearnings,
      );

      if (proposed) {
        diagnosticResult.learning_proposals_created += 1;
      }
    }
  }

  return { clusters, uncoveredClusters, result: diagnosticResult };
}
