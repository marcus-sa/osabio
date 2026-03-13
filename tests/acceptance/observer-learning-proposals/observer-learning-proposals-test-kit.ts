/**
 * Observer Learning Proposals Acceptance Test Kit
 *
 * Extends the learning-test-kit and observer-test-kit with helpers
 * specific to the diagnostic learning proposal pipeline.
 *
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId     (graph scan including diagnostic step)
 *   POST /api/observe/:table/:id            (event-driven observation creation)
 *   SurrealDB direct queries                (verification of outcomes)
 */
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Re-exports from both parent kits
// ---------------------------------------------------------------------------

export {
  setupLearningSuite,
  createTestWorkspace,
  createTestLearning,
  createTestLearningWithEmbedding,
  listActiveLearnings,
  listLearningsByStatus,
  getLearningById,
  getLearningEvidence,
  fakeLearningEmbedding,
  generateEmbedding,
  generateEmbeddings,
  type LearningRecord,
  type LearningStatus,
  type LearningSource,
  type LearningType,
  type AcceptanceTestRuntime,
  type TestUser,
} from "../agent-learnings/learning-test-kit";

export {
  setupObserverSuite,
  wireObserverEvents,
  createObservationByAgent,
  triggerGraphScan,
  waitForObservation,
  getObservationsForEntity,
  getWorkspaceObservations,
  setupObserverWorkspace,
  type ObservationRecord,
  type ObservationSeverity,
} from "../observer-agent/observer-test-kit";

import {
  createTestWorkspace as createLearningWorkspace,
  createTestLearning,
  generateEmbedding,
  generateEmbeddings,
  fakeLearningEmbedding,
  getLearningEvidence,
  type LearningRecord,
} from "../agent-learnings/learning-test-kit";

import {
  createObservationByAgent,
  triggerGraphScan,
  getWorkspaceObservations,
  setupObserverWorkspace,
} from "../observer-agent/observer-test-kit";

import { setupAcceptanceSuite, type AcceptanceTestRuntime } from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up a diagnostic learning proposals test suite with isolated server + DB.
 */
export function setupDiagnosticSuite(
  suiteName: string,
): () => AcceptanceTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationClusterSeed = {
  /** Common topic for the cluster (used to generate similar observation texts) */
  topic: string;
  /** Severity for all observations in the cluster */
  severity: "info" | "warning" | "conflict";
  /** Entity table to link observations to (e.g. "task", "decision") */
  entityTable?: string;
  /** Entity ID to link observations to */
  entityId?: string;
};

// ---------------------------------------------------------------------------
// Given Helpers -- Seed preconditions
// ---------------------------------------------------------------------------

/**
 * Creates a cluster of similar observations with embeddings targeting the same entity.
 *
 * Each observation has text variations on the same topic to produce
 * high embedding similarity (pairwise > 0.75).
 *
 * Returns observation IDs and the entity they are linked to.
 */
export async function createObservationCluster(
  surreal: Surreal,
  workspaceId: string,
  count: number,
  opts: ObservationClusterSeed,
): Promise<{
  observationIds: string[];
  entityTable: string;
  entityId: string;
}> {
  const entityTable = opts.entityTable ?? "task";
  const entityId = opts.entityId ?? `task-${crypto.randomUUID()}`;

  // Ensure the target entity exists
  const entityRecord = new RecordId(entityTable, entityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  if (entityTable === "task") {
    await surreal.query(`CREATE $entity CONTENT $content;`, {
      entity: entityRecord,
      content: {
        title: `Entity for ${opts.topic}`,
        status: "in_progress",
        workspace: workspaceRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  // Generate similar observation texts (variations on the same topic)
  const observationTexts = Array.from({ length: count }, (_, i) =>
    `${opts.topic} — occurrence ${i + 1}: this pattern continues to recur across workspace activities`,
  );

  // Generate real embeddings so clustering by similarity works
  const embeddingMap = await generateEmbeddings(observationTexts);

  const observationIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const obsId = `obs-${crypto.randomUUID()}`;
    const obsRecord = new RecordId("observation", obsId);
    const embedding = embeddingMap.get(observationTexts[i]);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: observationTexts[i],
        severity: opts.severity,
        status: "open",
        observation_type: "pattern",
        source_agent: "observer_agent",
        workspace: workspaceRecord,
        created_at: new Date(),
        ...(embedding ? { embedding } : {}),
      },
    });

    // Link to entity via observes edge
    await surreal.query(
      `RELATE $obs->observes->$entity SET added_at = time::now();`,
      { obs: obsRecord, entity: entityRecord },
    );

    observationIds.push(obsId);
  }

  return { observationIds, entityTable, entityId };
}

/**
 * Seeds an active learning that covers a pattern (for coverage check testing).
 *
 * The embedding is generated from the text so it will have high similarity
 * to observations about the same topic.
 */
export async function createActiveLearningCovering(
  surreal: Surreal,
  workspaceId: string,
  text: string,
): Promise<{ learningId: string; embedding: number[] }> {
  const embedding = await generateEmbedding(text);
  const { learningId } = await createTestLearning(surreal, workspaceId, {
    text,
    learning_type: "constraint",
    status: "active",
    source: "agent",
    suggested_by: "observer",
    embedding,
  });
  return { learningId, embedding };
}

/**
 * Seeds a dismissed learning for similarity gate testing.
 */
export async function createDismissedLearning(
  surreal: Surreal,
  workspaceId: string,
  text: string,
): Promise<{ learningId: string; embedding: number[] }> {
  const embedding = await generateEmbedding(text);
  const learningId = `learning-${crypto.randomUUID()}`;
  const learningRecord = new RecordId("learning", learningId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $learning CONTENT $content;`, {
    learning: learningRecord,
    content: {
      text,
      learning_type: "instruction",
      status: "dismissed",
      source: "agent",
      suggested_by: "observer",
      priority: "medium",
      target_agents: [],
      workspace: workspaceRecord,
      embedding,
      dismissed_at: new Date(),
      dismissed_reason: "Not applicable",
      created_at: new Date(),
    },
  });

  return { learningId, embedding };
}

/**
 * Seeds N recent agent-suggested learnings for rate limit testing.
 * All created within the past week from the observer agent.
 */
export async function seedRecentObserverLearnings(
  surreal: Surreal,
  workspaceId: string,
  count: number,
): Promise<string[]> {
  const learningIds: string[] = [];
  const workspaceRecord = new RecordId("workspace", workspaceId);

  for (let i = 0; i < count; i++) {
    const learningId = `learning-${crypto.randomUUID()}`;
    const learningRecord = new RecordId("learning", learningId);

    await surreal.query(`CREATE $learning CONTENT $content;`, {
      learning: learningRecord,
      content: {
        text: `Observer-suggested learning ${i + 1} for rate limit testing`,
        learning_type: "instruction",
        status: "pending_approval",
        source: "agent",
        suggested_by: "observer",
        priority: "medium",
        target_agents: [],
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    learningIds.push(learningId);
  }

  return learningIds;
}

/**
 * Seeds a pending_approval learning from the observer for dedup testing.
 * Embedding generated from text for similarity comparison.
 */
export async function createPendingLearningFromObserver(
  surreal: Surreal,
  workspaceId: string,
  text: string,
): Promise<{ learningId: string; embedding: number[] }> {
  const embedding = await generateEmbedding(text);
  const { learningId } = await createTestLearning(surreal, workspaceId, {
    text,
    learning_type: "constraint",
    status: "pending_approval",
    source: "agent",
    suggested_by: "observer",
    pattern_confidence: 0.85,
    embedding,
  });
  return { learningId, embedding };
}

/**
 * Creates observations older than 14 days for time window exclusion testing.
 */
export async function createAgedObservations(
  surreal: Surreal,
  workspaceId: string,
  count: number,
  daysOld: number,
  topic: string,
): Promise<string[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const pastDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const observationIds: string[] = [];

  const texts = Array.from({ length: count }, (_, i) =>
    `${topic} — aged occurrence ${i + 1}: this pattern was observed long ago`,
  );
  const embeddingMap = await generateEmbeddings(texts);

  for (let i = 0; i < count; i++) {
    const obsId = `obs-${crypto.randomUUID()}`;
    const obsRecord = new RecordId("observation", obsId);
    const embedding = embeddingMap.get(texts[i]);

    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: obsRecord,
      content: {
        text: texts[i],
        severity: "warning",
        status: "open",
        observation_type: "pattern",
        source_agent: "observer_agent",
        workspace: workspaceRecord,
        created_at: pastDate,
        ...(embedding ? { embedding } : {}),
      },
    });

    observationIds.push(obsId);
  }

  return observationIds;
}

// ---------------------------------------------------------------------------
// When Helpers -- Trigger driving ports
// ---------------------------------------------------------------------------

/**
 * Triggers the graph scan that includes the diagnostic learning proposal step.
 * This is the driving port for the batch diagnostic pipeline.
 */
export async function triggerDiagnosticPipeline(
  baseUrl: string,
  workspaceId: string,
  headers: Record<string, string>,
): Promise<Response> {
  return triggerGraphScan(baseUrl, workspaceId, headers);
}

/**
 * Creates an observation on an entity to trigger event-driven escalation.
 * When this is the 3rd+ observation on the entity, it triggers the diagnostic pipeline.
 *
 * Returns the new observation ID.
 */
export async function triggerObservationEscalation(
  surreal: Surreal,
  workspaceId: string,
  entityTable: string,
  entityId: string,
  text: string,
): Promise<{ observationId: string }> {
  return createObservationByAgent(surreal, workspaceId, "observer_agent", {
    text,
    severity: "warning",
    observationType: "pattern",
    targetTable: entityTable,
    targetId: entityId,
  });
}

// ---------------------------------------------------------------------------
// Then Helpers -- Verify outcomes
// ---------------------------------------------------------------------------

/**
 * Queries learnings proposed by the observer agent that are awaiting approval.
 */
export async function getPendingLearningsFromObserver(
  surreal: Surreal,
  workspaceId: string,
): Promise<LearningRecord[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const rows = (await surreal.query(
    `SELECT * FROM learning
     WHERE workspace = $ws
       AND source = "agent"
       AND suggested_by = "observer"
       AND status = "pending_approval"
     ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  )) as Array<LearningRecord[]>;
  return rows[0] ?? [];
}

/**
 * Finds a learning proposal that matches the cluster topic by text similarity.
 * Uses substring matching on the learning text against the cluster representative text.
 */
export async function getLearningProposalForCluster(
  surreal: Surreal,
  workspaceId: string,
  topicKeyword: string,
): Promise<LearningRecord | undefined> {
  const pending = await getPendingLearningsFromObserver(surreal, workspaceId);
  // Match by checking if the learning text relates to the cluster topic
  return pending.find((l) =>
    l.text.toLowerCase().includes(topicKeyword.toLowerCase()),
  );
}

/**
 * Parses the graph scan response to extract learning_proposals_created count.
 */
export async function getGraphScanResult(
  response: Response,
): Promise<{
  learning_proposals_created: number;
  observations_created: number;
  [key: string]: number;
}> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph scan failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<{
    learning_proposals_created: number;
    observations_created: number;
    [key: string]: number;
  }>;
}

/**
 * Counts open observations by the observer agent linked to a specific entity.
 */
export async function countObserverObservationsForEntity(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
): Promise<number> {
  const entityRecord = new RecordId(entityTable, entityId);
  // Two-step approach: first get observation IDs via graph traversal,
  // then count matching observations. Avoids SurrealDB subquery issues.
  const [obsIds] = (await surreal.query(
    `SELECT in AS obs_id FROM observes WHERE out = $entity;`,
    { entity: entityRecord },
  )) as [Array<{ obs_id: RecordId }>];

  if (!obsIds || obsIds.length === 0) return 0;

  const obsRecords = obsIds.map((r) => r.obs_id);
  const [countRows] = (await surreal.query(
    `SELECT count() AS count FROM $records
     WHERE source_agent = "observer_agent"
       AND status = "open"
     GROUP ALL;`,
    { records: obsRecords },
  )) as [Array<{ count: number }>];

  return countRows?.[0]?.count ?? 0;
}

/**
 * Verifies that evidence edges exist linking a learning to specific observation records.
 */
export async function verifyLearningEvidenceLinks(
  surreal: Surreal,
  learningId: string,
  expectedObservationIds: string[],
): Promise<{ linked: boolean; foundIds: string[] }> {
  const evidence = await getLearningEvidence(surreal, learningId);
  const foundIds = evidence
    .map((e) => e.out.id as string)
    .filter((id) => expectedObservationIds.includes(id));
  return {
    linked: foundIds.length === expectedObservationIds.length,
    foundIds,
  };
}
