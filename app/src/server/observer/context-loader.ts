/**
 * Context loader: effect boundary for loading graph context needed by LLM reasoning.
 *
 * Encapsulates all SurrealDB queries needed to assemble the reasoning context.
 * Returns plain data objects consumed by both deterministic and LLM pipelines.
 */

import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelatedDecision = {
  id: string;
  table_id: string;
  summary: string;
  status: string;
  rationale?: string;
};

export type EntityContext = {
  entityTable: string;
  entityId: string;
  entityTitle: string;
  entityDescription?: string;
  entityStatus?: string;
  relatedDecisions: RelatedDecision[];
  validEntityIds: Set<string>;
};

// ---------------------------------------------------------------------------
// Load related decisions for an entity's project (max 20, by recency)
// ---------------------------------------------------------------------------

export async function loadRelatedDecisions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord?: RecordId<"project", string>,
): Promise<RelatedDecision[]> {
  if (!projectRecord) return [];

  const [rows] = await surreal.query<[Array<{
    id: RecordId<"decision">;
    summary: string;
    status: string;
    rationale?: string;
    updated_at: string | Date;
  }>]>(
    `SELECT id, summary, status, rationale, updated_at FROM decision
     WHERE workspace = $ws
       AND status IN ["confirmed", "provisional"]
       AND ->belongs_to->project CONTAINS $project
     ORDER BY updated_at DESC
     LIMIT 20;`,
    { ws: workspaceRecord, project: projectRecord },
  );

  return (rows ?? []).map((row) => ({
    id: row.id.id as string,
    table_id: `decision:${row.id.id as string}`,
    summary: row.summary,
    status: row.status,
    rationale: row.rationale,
  }));
}

// ---------------------------------------------------------------------------
// Resolve the project for an entity via belongs_to edge
// ---------------------------------------------------------------------------

export async function resolveEntityProject(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
): Promise<RecordId<"project", string> | undefined> {
  const entityRecord = new RecordId(entityTable, entityId);

  const [rows] = await surreal.query<[Array<{
    project: RecordId<"project">[];
  }>]>(
    `SELECT ->belongs_to->project AS project FROM $entity;`,
    { entity: entityRecord },
  );

  const projects = rows?.[0]?.project;
  if (!projects || projects.length === 0) return undefined;

  return projects[0] as RecordId<"project", string>;
}

// ---------------------------------------------------------------------------
// Load entity body from DB when not provided by caller
// ---------------------------------------------------------------------------

async function loadEntityBody(
  surreal: Surreal,
  entityTable: string,
  entityId: string,
): Promise<Record<string, unknown> | undefined> {
  const entityRecord = new RecordId(entityTable, entityId);

  const [rows] = await surreal.query<[Array<Record<string, unknown>>]>(
    `SELECT title, summary, description, status FROM $entity;`,
    { entity: entityRecord },
  );

  return rows?.[0];
}

// ---------------------------------------------------------------------------
// Build complete entity context for LLM reasoning
// ---------------------------------------------------------------------------

export async function buildEntityContext(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityTable: string,
  entityId: string,
  entityBody?: Record<string, unknown>,
): Promise<EntityContext> {
  // Load entity from DB when body not provided by caller
  const body = entityBody ?? await loadEntityBody(surreal, entityTable, entityId);
  const entityTitle = (body?.title as string) ?? (body?.summary as string) ?? "Unknown";
  const entityDescription = body?.description as string | undefined;
  const entityStatus = body?.status as string | undefined;

  // Resolve project and load related decisions
  const projectRecord = await resolveEntityProject(surreal, entityTable, entityId);
  const relatedDecisions = await loadRelatedDecisions(surreal, workspaceRecord, projectRecord);

  // Build valid entity ID set for evidence validation
  const validEntityIds = new Set<string>();
  validEntityIds.add(`${entityTable}:${entityId}`);
  for (const d of relatedDecisions) {
    validEntityIds.add(d.table_id);
  }
  if (projectRecord) {
    validEntityIds.add(`project:${projectRecord.id as string}`);
  }

  return {
    entityTable,
    entityId,
    entityTitle,
    entityDescription,
    entityStatus,
    relatedDecisions,
    validEntityIds,
  };
}
