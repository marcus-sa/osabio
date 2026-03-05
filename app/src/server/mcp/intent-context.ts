import { RecordId, type Surreal } from "surrealdb";
import { buildWorkspaceOverview, buildProjectContext, buildTaskContext } from "./context-builder";
import { searchEntitiesByEmbedding, type SearchEntityKind } from "../graph/queries";
import { createEmbeddingVector } from "../graph/embeddings";
import type { ContextPacket, TaskContextPacket, WorkspaceOverview } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentContextInput = {
  intent: string;
  cwd?: string;
  paths?: string[];
};

export type IntentContextResult =
  | { level: "task"; data: TaskContextPacket }
  | { level: "project"; data: ContextPacket }
  | { level: "workspace"; data: WorkspaceOverview };

type ProjectRow = {
  id: RecordId<"project", string>;
  name: string;
  status: string;
  description?: string;
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export async function resolveIntentContext(input: {
  surreal: Surreal;
  embeddingModel: Parameters<typeof createEmbeddingVector>[0];
  embeddingDimension: number;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  intent: string;
  cwd?: string;
  paths?: string[];
}): Promise<IntentContextResult> {
  const { surreal, embeddingModel, embeddingDimension, workspaceRecord, workspaceName, intent } = input;

  // Step 1: Explicit entity references in intent text
  const explicitTask = extractEntityRef(intent, "task");
  if (explicitTask) {
    try {
      const data = await buildTaskContext({ surreal, workspaceRecord, workspaceName, taskId: explicitTask });
      return { level: "task", data };
    } catch {
      // Task not found — fall through to other strategies
    }
  }

  const explicitProject = extractEntityRef(intent, "project");
  if (explicitProject) {
    try {
      const projectRecord = new RecordId("project", explicitProject);
      const data = await buildProjectContext({ surreal, workspaceRecord, workspaceName, projectRecord });
      return { level: "project", data };
    } catch {
      // Project not found — fall through
    }
  }

  // Step 2: Single-project shortcut
  const projects = await listWorkspaceProjects(surreal, workspaceRecord);
  if (projects.length === 1) {
    const data = await buildProjectContext({
      surreal,
      workspaceRecord,
      workspaceName,
      projectRecord: projects[0].id,
    });
    return { level: "project", data };
  }

  // Step 3: Vector search — embed intent, match against all entities
  const queryEmbedding = await createEmbeddingVector(embeddingModel, intent, embeddingDimension);
  if (queryEmbedding) {
    const results = await searchEntitiesByEmbedding({
      surreal,
      workspaceRecord,
      queryEmbedding,
      limit: 5,
    });

    if (results.length > 0 && results[0].score > 0.3) {
      const top = results[0];

      if (top.kind === "task") {
        const taskId = top.id.includes(":") ? top.id.split(":")[1] : top.id;
        try {
          const data = await buildTaskContext({ surreal, workspaceRecord, workspaceName, taskId });
          return { level: "task", data };
        } catch {
          // Fall through
        }
      }

      // For project/feature matches, or task fallback: resolve to project context
      const projectRecord = await resolveProjectFromMatch(surreal, top);
      if (projectRecord) {
        const data = await buildProjectContext({ surreal, workspaceRecord, workspaceName, projectRecord });
        return { level: "project", data };
      }
    }
  }

  // Step 4: Path matching — match directory names against project names
  const allPaths = [...(input.paths ?? [])];
  if (input.cwd) allPaths.push(input.cwd);

  if (allPaths.length > 0 && projects.length > 0) {
    const matched = matchPathToProject(allPaths, projects);
    if (matched) {
      const data = await buildProjectContext({ surreal, workspaceRecord, workspaceName, projectRecord: matched });
      return { level: "project", data };
    }
  }

  // Step 5: Fallback — workspace overview
  const data = await buildWorkspaceOverview({ surreal, workspaceRecord, workspaceName });
  return { level: "workspace", data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract explicit entity reference like `task:abc123` or `project:def456` from text */
function extractEntityRef(text: string, entityType: string): string | undefined {
  const pattern = new RegExp(`\\b${entityType}:([a-zA-Z0-9_-]+)`, "i");
  const match = text.match(pattern);
  return match ? match[1] : undefined;
}

/** List all projects in a workspace */
async function listWorkspaceProjects(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ProjectRow[]> {
  const [rows] = await surreal
    .query<[ProjectRow[]]>(
      `SELECT id, name, status, description FROM project
       WHERE id IN (SELECT VALUE out FROM has_project WHERE \`in\` = $workspace);`,
      { workspace: workspaceRecord },
    )
    .collect<[ProjectRow[]]>();
  return rows;
}

/** Resolve a search match to a project RecordId */
async function resolveProjectFromMatch(
  surreal: Surreal,
  match: { id: string; kind: SearchEntityKind },
): Promise<RecordId<"project", string> | undefined> {
  if (match.kind === "project") {
    const rawId = match.id.includes(":") ? match.id.split(":")[1] : match.id;
    return new RecordId("project", rawId);
  }

  // For task/decision/question/suggestion: find project via belongs_to
  // For feature: find project via has_feature (reverse)
  const rawId = match.id.includes(":") ? match.id.split(":")[1] : match.id;
  const table = match.kind;
  const entityRecord = new RecordId(table, rawId);

  if (match.kind === "feature") {
    const [rows] = await surreal
      .query<[Array<{ in: RecordId<"project", string> }>]>(
        `SELECT \`in\` FROM has_feature WHERE out = $entity LIMIT 1;`,
        { entity: entityRecord },
      )
      .collect<[Array<{ in: RecordId<"project", string> }>]>();
    return rows.length > 0 ? rows[0].in : undefined;
  }

  // task, decision, question, suggestion → belongs_to → project
  const [rows] = await surreal
    .query<[Array<{ out: RecordId<"project", string> }>]>(
      `SELECT out FROM belongs_to WHERE \`in\` = $entity AND record::tb(out) = "project" LIMIT 1;`,
      { entity: entityRecord },
    )
    .collect<[Array<{ out: RecordId<"project", string> }>]>();
  return rows.length > 0 ? rows[0].out : undefined;
}

/** Match directory paths against project names using normalized token overlap */
function matchPathToProject(
  paths: string[],
  projects: ProjectRow[],
): RecordId<"project", string> | undefined {
  const pathTokens = new Set<string>();
  for (const p of paths) {
    for (const segment of p.split("/").filter(Boolean)) {
      for (const token of segment.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/)) {
        if (token.length > 2) pathTokens.add(token);
      }
    }
  }

  if (pathTokens.size === 0) return undefined;

  let bestProject: ProjectRow | undefined;
  let bestOverlap = 0;

  for (const project of projects) {
    const nameTokens = new Set(
      project.name.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((t) => t.length > 2),
    );
    let overlap = 0;
    for (const token of nameTokens) {
      if (pathTokens.has(token)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestProject = project;
    }
  }

  return bestProject ? bestProject.id : undefined;
}
