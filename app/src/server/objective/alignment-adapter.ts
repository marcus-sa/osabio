/**
 * Alignment Adapter — SurrealDB implementations of authorizer alignment ports.
 *
 * Primary path: Graph traversal (task->belongs_to->project<-has_objective<-objective)
 * Fallback path: BM25 fulltext search on objective.title
 * Legacy path: KNN vector search (retained for backward compatibility)
 *
 * Graph traversal is preferred for typed, linked data (ADR-062).
 * BM25 fallback handles unlinked intents where no entity reference is available.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { FindAlignedObjectives, FindAlignedObjectivesViaGraph, CreateSupportsEdge } from "../intent/authorizer";
import {
  buildGraphTraversalCandidates,
  buildBm25Candidates,
  type AlignmentCandidate,
} from "./alignment";

// ---------------------------------------------------------------------------
// Entity Reference Type
// ---------------------------------------------------------------------------

export type EntityReference = {
  table: "task" | "project";
  id: string;
};

// ---------------------------------------------------------------------------
// BM25 Query Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// FindAlignedObjectivesViaGraph Adapter (Graph + BM25)
// ---------------------------------------------------------------------------

/**
 * Creates a FindAlignedObjectivesViaGraph port backed by SurrealDB graph traversal
 * with BM25 fulltext fallback.
 *
 * Primary path (graph traversal — deterministic):
 *   1. Receive resolved entity reference (task or project RecordId)
 *   2. Graph traversal: task -> belongs_to -> project <- has_objective <- objective
 *      (or project <- has_objective <- objective for direct project refs)
 *   3. Return linked active objectives with score = 1.0
 *
 * Fallback path (BM25 — for unresolved intents):
 *   1. BM25 search on objective.title (index from migration 0034)
 *   2. Return candidates with normalized BM25 scores
 *   3. Classify as "ambiguous" (BM25 match is weaker signal than graph path)
 */
export function findAlignedObjectivesViaGraph(
  surreal: Surreal,
): FindAlignedObjectivesViaGraph {
  return async (entityRef, workspaceId, descriptionText) => {
    // Primary path: graph traversal when entity reference is available
    if (entityRef) {
      const graphCandidates = await findObjectivesViaGraphTraversal(
        surreal,
        entityRef,
        workspaceId,
      );
      if (graphCandidates.length > 0) {
        return graphCandidates;
      }
      // Graph traversal found no objectives — fall through to BM25
    }

    // Fallback path: BM25 fulltext search on objective.title
    if (descriptionText && descriptionText.trim().length > 0) {
      return await findObjectivesViaBm25(surreal, workspaceId, descriptionText);
    }

    return [];
  };
}

/**
 * Graph traversal: resolve objectives linked to a task or project.
 *
 * Uses SurrealDB arrow syntax for direct graph traversal:
 *   task:  $entity->belongs_to->project->has_objective->objective
 *   project: $entity->has_objective->objective
 *
 * Filters by workspace scope and active status.
 */
async function findObjectivesViaGraphTraversal(
  surreal: Surreal,
  entityRef: EntityReference,
  workspaceId: RecordId<"workspace">,
): Promise<AlignmentCandidate[]> {
  const entityRecord = new RecordId(entityRef.table, entityRef.id);

  const traversalPath = entityRef.table === "task"
    ? "$entity->belongs_to->project->has_objective->objective"
    : "$entity->has_objective->objective";

  const rows = (await surreal.query(
    `SELECT id, title FROM ${traversalPath} WHERE workspace = $ws AND status = 'active';`,
    { entity: entityRecord, ws: workspaceId },
  )) as [Array<{ id: RecordId<"objective">; title: string }>];

  const graphRows = (rows[0] ?? []).map((row) => ({
    objectiveId: row.id.id as string,
    title: row.title,
  }));

  return buildGraphTraversalCandidates(graphRows);
}

/**
 * BM25 fulltext search on objective.title within workspace scope.
 */
async function findObjectivesViaBm25(
  surreal: Surreal,
  workspaceId: RecordId<"workspace">,
  searchText: string,
): Promise<AlignmentCandidate[]> {
  const rows = (await surreal.query(
    `SELECT id, title, search::score(1) AS score
     FROM objective
     WHERE title @1@ $query
       AND workspace = $ws
       AND status = 'active'
     ORDER BY score DESC
     LIMIT 10;`,
    { ws: workspaceId, query: searchText },
  )) as [Array<{ id: RecordId<"objective">; title: string; score: number }>];

  const bm25Rows = (rows[0] ?? []).map((row) => ({
    objectiveId: row.id.id as string,
    title: row.title,
    score: row.score,
  }));

  return buildBm25Candidates(bm25Rows);
}

// ---------------------------------------------------------------------------
// FindAlignedObjectives Adapter (BM25 — replaces legacy KNN)
// ---------------------------------------------------------------------------

/**
 * Creates a FindAlignedObjectives port backed by BM25 fulltext search.
 * Accepts intent description text instead of embedding vector.
 */
export function findAlignedObjectivesSurreal(
  surreal: Surreal,
): FindAlignedObjectives {
  return async (intentText, workspaceId) => {
    if (!intentText || intentText.trim().length === 0) return [];
    return findObjectivesViaBm25(surreal, workspaceId, intentText);
  };
}

// ---------------------------------------------------------------------------
// CreateSupportsEdge Adapter
// ---------------------------------------------------------------------------

/**
 * Creates a CreateSupportsEdge port backed by SurrealDB RELATE.
 */
export function createSupportsEdgeSurreal(
  surreal: Surreal,
): CreateSupportsEdge {
  return async (intentId, objectiveId, alignmentScore, alignmentMethod) => {
    const objectiveRecord = new RecordId("objective", objectiveId);
    await surreal.query(
      `RELATE $intent->supports->$objective CONTENT $content;`,
      {
        intent: intentId,
        objective: objectiveRecord,
        content: {
          alignment_score: alignmentScore,
          alignment_method: alignmentMethod,
          added_at: new Date(),
        },
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Warning Observation for Unaligned Intents
// ---------------------------------------------------------------------------

/**
 * Creates a warning observation when an intent has no objective match above threshold.
 */
export async function createAlignmentWarningObservation(
  surreal: Surreal,
  workspaceId: RecordId<"workspace">,
  intentId: RecordId<"intent">,
  bestScore: number,
): Promise<void> {
  const observationId = crypto.randomUUID();
  const observationRecord = new RecordId("observation", observationId);

  await surreal.query(`CREATE $obs CONTENT $content;`, {
    obs: observationRecord,
    content: {
      text: `Intent has no supporting objective (best alignment score: ${bestScore.toFixed(2)}). Agent work may not align with organizational goals.`,
      severity: "warning",
      status: "open",
      observation_type: "alignment",
      source_agent: "authorizer",
      workspace: workspaceId,
      verified: false,
      evidence_refs: [intentId],
      created_at: new Date(),
    },
  });
}
