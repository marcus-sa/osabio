/**
 * Alignment Adapter — SurrealDB implementations of authorizer alignment ports.
 *
 * Implements FindAlignedObjectives and CreateSupportsEdge using SurrealDB
 * KNN vector search against the objective table's HNSW index.
 *
 * Uses the two-step KNN query pattern required by the SurrealDB v3.0
 * KNN + WHERE bug (objective table has B-tree indexes on workspace/status).
 */
import { RecordId, type Surreal } from "surrealdb";
import type { FindAlignedObjectives, CreateSupportsEdge } from "../intent/authorizer";

// ---------------------------------------------------------------------------
// FindAlignedObjectives Adapter
// ---------------------------------------------------------------------------

/**
 * Creates a FindAlignedObjectives port backed by SurrealDB KNN search.
 *
 * Two-step query pattern:
 *   1. KNN on HNSW index (no WHERE filter)
 *   2. Filter by workspace + active status (B-tree index)
 */
export function findAlignedObjectivesSurreal(
  surreal: Surreal,
): FindAlignedObjectives {
  return async (intentEmbedding, workspaceId) => {
    const rows = (await surreal.query(
      `LET $candidates = SELECT id, title, workspace, status,
          vector::similarity::cosine(embedding, $vec) AS score
        FROM objective WHERE embedding <|20, COSINE|> $vec;
       SELECT id, title, score FROM $candidates
        WHERE workspace = $ws AND status = 'active'
        ORDER BY score DESC LIMIT 10;`,
      { vec: intentEmbedding, ws: workspaceId },
    )) as [null, Array<{ id: RecordId<"objective">; title: string; score: number }>];

    const candidates = rows[1] ?? [];
    return candidates.map((row) => ({
      objectiveId: row.id.id as string,
      title: row.title,
      score: row.score,
    }));
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
