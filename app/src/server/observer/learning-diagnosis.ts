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
import { logError, logInfo } from "../http/observability";
import { rootCauseSchema, type RootCauseClassification } from "./schemas";
import { OBSERVER_IDENTITY } from "../agents/observer/prompt";
import { checkRateLimit, suggestLearning } from "../learning/detector";
import { createObservation } from "../observation/queries";
import { cosineSimilarity, createEmbeddingVector } from "../graph/embeddings";
import { analyzeTrend, type ScorePoint, type TrendPattern, type TrendResult } from "../behavior/trends";
import type { CreateLearningInput } from "../learning/types";
import type { embed } from "ai";

type EmbeddingModel = Parameters<typeof embed>[0]["model"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationWithEmbedding = {
  id: string;
  text: string;
  severity: string;
  embedding: number[];
  entityRefs: string[];
};

export type ObservationCluster = {
  observations: Array<{ id: string; text: string; severity: string; entityRefs: string[] }>;
  representativeText: string;
  clusterSize: number;
};

export type CoverageCheckResult =
  | { covered: false }
  | { covered: true; matchedLearningText: string; similarity: number };

export type DiagnosticResult = {
  learning_proposals_created: number;
  coverage_skips: number;
  clusters_found: number;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CLUSTER_SIMILARITY_THRESHOLD = 0.75;
const MINIMUM_CLUSTER_SIZE = 3;
const TIME_WINDOW_DAYS = 14;
// Coverage threshold is lower than typical dedup thresholds (0.85) because
// we compare observation-text centroids (descriptive, noisy) against learning-text
// embeddings (directive, concise). Cross-form comparisons consistently score
// 30-40% lower on cosine similarity than same-form comparisons.
const COVERAGE_SIMILARITY_THRESHOLD = 0.50;
// Same cross-domain text form issue as coverage threshold — observation
// centroids vs dismissed learning embeddings. Lower than the dismissed
// re-suggestion gate (0.85) in suggestLearning() which compares same-form texts.
const DISMISSED_PATTERN_SIMILARITY_THRESHOLD = 0.50;

// ---------------------------------------------------------------------------
// Observation query (IO boundary)
// ---------------------------------------------------------------------------

/**
 * Queries open/acknowledged observations from the past 14 days with embeddings.
 * Uses two-step KNN pattern per SurrealDB HNSW+WHERE bug.
 */
export async function queryRecentObservationsWithEmbeddings(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ObservationWithEmbedding[]> {
  const cutoff = new Date(Date.now() - TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [rows] = await surreal.query<[Array<{
    id: RecordId<"observation">;
    text: string;
    severity: string;
    embedding: number[];
    entity_refs: Array<RecordId | string>;
    created_at: string;
  }>]>(
    `SELECT id, text, severity, embedding, created_at,
            ->observes->task.id AS entity_refs
     FROM observation
     WHERE workspace = $ws
       AND status IN ["open", "acknowledged"]
       AND created_at > $cutoff
       AND embedding IS NOT NONE
     ORDER BY created_at DESC
     LIMIT 200;`,
    { ws: workspaceRecord, cutoff },
  );

  return (rows ?? []).map((row) => ({
    id: row.id.id as string,
    text: row.text,
    severity: row.severity,
    embedding: row.embedding,
    entityRefs: (row.entity_refs ?? [])
      .filter((ref): ref is RecordId => typeof ref === "object" && ref !== null && "id" in ref)
      .map((ref) => `task:${ref.id as string}`),
  }));
}

// ---------------------------------------------------------------------------
// Pure clustering (no IO)
// ---------------------------------------------------------------------------

/**
 * Clusters observations by pairwise embedding similarity using single-linkage.
 *
 * Algorithm:
 * 1. Build adjacency: observation A is neighbor of B if similarity > threshold
 * 2. Connected components via BFS form clusters
 * 3. Filter clusters by minimum size
 *
 * Pure function -- no IO.
 */
export function clusterObservationsBySimilarity(
  observations: ObservationWithEmbedding[],
  similarityThreshold: number = CLUSTER_SIMILARITY_THRESHOLD,
  minimumClusterSize: number = MINIMUM_CLUSTER_SIZE,
): ObservationCluster[] {
  if (observations.length < minimumClusterSize) return [];

  // Build adjacency list
  const adjacency = new Map<number, Set<number>>();
  for (let i = 0; i < observations.length; i++) {
    adjacency.set(i, new Set());
  }

  for (let i = 0; i < observations.length; i++) {
    for (let j = i + 1; j < observations.length; j++) {
      const similarity = cosineSimilarity(
        observations[i].embedding,
        observations[j].embedding,
      );
      if (similarity > similarityThreshold) {
        adjacency.get(i)!.add(j);
        adjacency.get(j)!.add(i);
      }
    }
  }

  // BFS to find connected components
  const visited = new Set<number>();
  const clusters: ObservationCluster[] = [];

  for (let i = 0; i < observations.length; i++) {
    if (visited.has(i)) continue;

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

      // Representative text: the observation with highest average similarity to others in cluster
      const representativeIndex = pickRepresentativeIndex(component, observations);

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
 * Computes the centroid (element-wise average) of a set of embedding vectors.
 * This reduces noise from individual observation text variations, producing
 * a more representative embedding for cluster-level similarity comparisons.
 */
function computeCentroidEmbedding(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return embeddings[0];

  const dimension = embeddings[0].length;
  const centroid = new Array<number>(dimension).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      centroid[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}

/**
 * Picks the observation with highest average similarity to other cluster members.
 */
function pickRepresentativeIndex(
  componentIndices: number[],
  observations: ObservationWithEmbedding[],
): number {
  let bestIndex = componentIndices[0];
  let bestAvgSimilarity = -1;

  for (const i of componentIndices) {
    let totalSimilarity = 0;
    for (const j of componentIndices) {
      if (i !== j) {
        totalSimilarity += cosineSimilarity(
          observations[i].embedding,
          observations[j].embedding,
        );
      }
    }
    const avgSimilarity = totalSimilarity / (componentIndices.length - 1);
    if (avgSimilarity > bestAvgSimilarity) {
      bestAvgSimilarity = avgSimilarity;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// ---------------------------------------------------------------------------
// Coverage check (IO boundary -- KNN query)
// ---------------------------------------------------------------------------

/**
 * Checks if any learning with a given status covers the cluster pattern.
 * Uses two-step KNN pattern per SurrealDB HNSW+WHERE bug, with brute-force fallback.
 */
async function checkLearningCoverage(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  clusterEmbedding: number[],
  learningStatus: "active" | "dismissed",
  similarityThreshold: number,
): Promise<CoverageCheckResult> {
  const results = await surreal
    .query<[undefined, Array<{ text: string; similarity: number }>]>(
      [
        "LET $candidates = SELECT id, text, workspace, status,",
        "vector::similarity::cosine(embedding, $embedding) AS similarity",
        "FROM learning WHERE embedding <|10, COSINE|> $embedding;",
        "SELECT text, similarity FROM $candidates",
        "WHERE workspace = $ws AND status = $status AND similarity > $threshold",
        "ORDER BY similarity DESC LIMIT 1;",
      ].join("\n"),
      {
        embedding: clusterEmbedding,
        ws: workspaceRecord,
        status: learningStatus,
        threshold: similarityThreshold,
      },
    );

  const matches = results[1] ?? [];
  const match = matches[0];
  if (match) {
    return { covered: true, matchedLearningText: match.text, similarity: match.similarity };
  }

  // Brute-force fallback when HNSW index hasn't indexed recent inserts
  const [learnings] = await surreal.query<[Array<{ text: string; embedding: number[] }>]>(
    `SELECT text, embedding FROM learning
     WHERE workspace = $ws
       AND status = $status
       AND embedding IS NOT NONE;`,
    { ws: workspaceRecord, status: learningStatus },
  );

  if (learningStatus === "active") {
    logInfo("observer.learning.coverage_fallback", "Fallback coverage check", {
      activeLearningsCount: (learnings ?? []).length,
      workspaceId: workspaceRecord.id,
    });
  }

  for (const learning of learnings ?? []) {
    const similarity = cosineSimilarity(clusterEmbedding, learning.embedding);
    if (similarity > similarityThreshold) {
      return { covered: true, matchedLearningText: learning.text, similarity };
    }
  }

  return { covered: false };
}

export async function checkCoverageAgainstActiveLearnings(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  clusterEmbedding: number[],
): Promise<CoverageCheckResult> {
  return checkLearningCoverage(surreal, workspaceRecord, clusterEmbedding, "active", COVERAGE_SIMILARITY_THRESHOLD);
}

export async function checkDismissedLearningForCluster(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  clusterEmbedding: number[],
): Promise<CoverageCheckResult> {
  return checkLearningCoverage(surreal, workspaceRecord, clusterEmbedding, "dismissed", DISMISSED_PATTERN_SIMILARITY_THRESHOLD);
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
      prompt,
      abortSignal: AbortSignal.timeout(CLASSIFICATION_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;
    logInfo("observer.llm.root_cause", "Root cause classification completed", {
      latencyMs,
      category: result.object.category,
      confidence: result.object.confidence,
      shouldPropose: result.object.should_propose_learning,
    });

    return result.object;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logError("observer.llm.root_cause_error", "Root cause classification failed", {
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
    logInfo("observer.behavior.learning_proposed", "Learning proposed from behavior trend", {
      identityId: input.identityId,
      metricType: input.metricType,
      trendPattern: input.trendPattern,
      learningId: result.learningRecord.id,
    });
    return { created: true, learningRecord: result.learningRecord };
  }

  logInfo("observer.behavior.learning_blocked", "Behavior learning proposal blocked", {
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
  embeddingModel?: EmbeddingModel,
  embeddingDimension?: number,
): Promise<{ proposed: boolean }> {
  const classification = await classifyRootCause(model, cluster, existingLearnings);

  if (!classification) {
    logInfo("observer.learning.classification_skipped", "Skipping cluster due to failed LLM classification", {
      clusterSize: cluster.clusterSize,
      representativeText: cluster.representativeText.slice(0, 100),
    });
    return { proposed: false };
  }

  if (shouldProposeLearning(classification)) {
    const learningInput = rootCauseToLearningInput(classification, cluster);

    // Generate embedding for the proposed learning text to enable
    // dismissed similarity gate and persist with the learning record
    const embedding = embeddingModel && embeddingDimension
      ? await createEmbeddingVector(embeddingModel, learningInput.text, embeddingDimension)
      : undefined;

    const result = await suggestLearning({
      surreal,
      workspaceRecord,
      learning: learningInput,
      embedding,
      now: new Date(),
    });

    if (result.created) {
      logInfo("observer.learning.proposed", "Learning proposed from root cause analysis", {
        category: classification.category,
        confidence: classification.confidence,
        learningType: classification.proposed_learning_type,
        learningId: result.learningRecord.id,
      });
      return { proposed: true };
    }

    logInfo("observer.learning.gate_blocked", "Learning proposal blocked by safety gate", {
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

  logInfo("observer.learning.low_confidence", "Pattern observed but confidence too low for learning proposal", {
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
 * 1. Query recent observations with embeddings
 * 2. Cluster by pairwise similarity
 * 3. For each cluster, check coverage against active learnings
 * 4. For uncovered clusters, classify root cause via LLM
 * 5. Propose learning or create observation based on dual gate
 */
export async function runDiagnosticClustering(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  observerModel: LanguageModel,
  embeddingModel: EmbeddingModel,
  embeddingDimension: number,
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

  // Step 1: Query recent observations
  const observations = await queryRecentObservationsWithEmbeddings(
    surreal,
    workspaceRecord,
  );

  if (observations.length < MINIMUM_CLUSTER_SIZE) {
    return { clusters: [], uncoveredClusters: [], result: diagnosticResult };
  }

  // Step 2: Cluster by similarity (pure)
  const clusters = clusterObservationsBySimilarity(observations);
  diagnosticResult.clusters_found = clusters.length;

  if (clusters.length === 0) {
    return { clusters: [], uncoveredClusters: [], result: diagnosticResult };
  }

  // Step 3: Coverage check for each cluster
  const uncoveredClusters: ObservationCluster[] = [];

  for (const cluster of clusters) {
    // Compute cluster centroid embedding (average of all observation embeddings)
    // to reduce noise from individual observation text variations
    const clusterObsWithEmbeddings = cluster.observations
      .map((co) => observations.find((o) => o.id === co.id))
      .filter((o): o is ObservationWithEmbedding => o !== undefined && o.embedding.length > 0);

    if (clusterObsWithEmbeddings.length === 0) {
      uncoveredClusters.push(cluster);
      continue;
    }

    const centroidEmbedding = computeCentroidEmbedding(
      clusterObsWithEmbeddings.map((o) => o.embedding),
    );

    const coverage = await checkCoverageAgainstActiveLearnings(
      surreal,
      workspaceRecord,
      centroidEmbedding,
    );

    if (coverage.covered) {
      logInfo("observer.learning.coverage_skip", "Cluster pattern already covered by active learning", {
        clusterSize: cluster.clusterSize,
        matchedLearningText: coverage.matchedLearningText,
        similarity: coverage.similarity,
      });
      diagnosticResult.coverage_skips += 1;
      continue;
    }

    // Check if a dismissed learning already covers this pattern
    const dismissedCheck = await checkDismissedLearningForCluster(
      surreal,
      workspaceRecord,
      centroidEmbedding,
    );

    if (dismissedCheck.covered) {
      logInfo("observer.learning.dismissed_skip", "Cluster pattern matches a previously dismissed learning", {
        clusterSize: cluster.clusterSize,
        matchedLearningText: dismissedCheck.matchedLearningText,
        similarity: dismissedCheck.similarity,
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
        embeddingModel,
        embeddingDimension,
      );

      if (proposed) {
        diagnosticResult.learning_proposals_created += 1;
      }
    }
  }

  return { clusters, uncoveredClusters, result: diagnosticResult };
}
