import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { HttpError } from "../http/errors";

type HasProjectRow = {
  id: RecordId<"has_project", string>;
};

type HasFeatureRow = {
  id: RecordId<"has_feature", string>;
};

export type ProjectScopeRow = {
  id: RecordId<"project", string>;
  name: string;
};

export async function ensureDefaultWorkspaceProjectScope(surreal: Surreal): Promise<void> {
  const now = new Date();
  const workspaceRecord = new RecordId("workspace", "default");
  const projectRecord = new RecordId("project", "brain");

  const workspace = await surreal.select<{ id: RecordId<"workspace", string> }>(workspaceRecord);
  if (!workspace) {
    await surreal.create(workspaceRecord).content({
      name: "Marcus's Brain",
      status: "active",
      description: "Default dogfooding workspace",
      onboarding_complete: true,
      onboarding_turn_count: 0,
      onboarding_summary_pending: false,
      onboarding_started_at: now,
      onboarding_completed_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  const project = await surreal.select<{ id: RecordId<"project", string> }>(projectRecord);
  if (!project) {
    await surreal.create(projectRecord).content({
      name: "AI-Native Business Management Platform",
      status: "active",
      description: "Default dogfooding project",
      created_at: now,
      updated_at: now,
    });
  }

  await ensureWorkspaceProjectEdge(surreal, workspaceRecord, projectRecord, now);
}

export async function ensureWorkspaceProjectEdge(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  now: Date,
): Promise<void> {
  const [edgeRows] = await surreal
    .query<[HasProjectRow[]]>(
      "SELECT id FROM has_project WHERE `in` = $workspace AND out = $project LIMIT 1;",
      {
        workspace: workspaceRecord,
        project: projectRecord,
      },
    )
    .collect<[HasProjectRow[]]>();

  if (edgeRows.length === 0) {
    await surreal.relate(workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
      added_at: now,
    }).output("after");
  }
}

export async function ensureProjectFeatureEdge(
  surreal: Surreal,
  projectRecord: RecordId<"project", string>,
  featureRecord: RecordId<"feature", string>,
  now: Date,
): Promise<void> {
  const [edgeRows] = await surreal
    .query<[HasFeatureRow[]]>(
      "SELECT id FROM has_feature WHERE `in` = $project AND out = $feature LIMIT 1;",
      {
        project: projectRecord,
        feature: featureRecord,
      },
    )
    .collect<[HasFeatureRow[]]>();

  if (edgeRows.length === 0) {
    await surreal.relate(projectRecord, new RecordId("has_feature", randomUUID()), featureRecord, {
      added_at: now,
    }).output("after");
  }
}

export async function resolveWorkspaceRecord(
  surreal: Surreal,
  workspaceId: string,
): Promise<RecordId<"workspace", string>> {
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const workspace = await surreal.select<{ id: RecordId<"workspace", string> }>(workspaceRecord);
  if (!workspace) {
    throw new HttpError(404, `workspace not found: ${workspaceId}`);
  }
  return workspaceRecord;
}

export async function resolveWorkspaceProjectRecord(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectId: string,
): Promise<RecordId<"project", string>> {
  const projectRecord = new RecordId("project", projectId);
  const project = await surreal.select<{ id: RecordId<"project", string> }>(projectRecord);
  if (!project) {
    throw new HttpError(404, `project not found: ${projectId}`);
  }

  const [edgeRows] = await surreal
    .query<[HasProjectRow[]]>(
      "SELECT id FROM has_project WHERE `in` = $workspace AND out = $project LIMIT 1;",
      {
        workspace: workspaceRecord,
        project: projectRecord,
      },
    )
    .collect<[HasProjectRow[]]>();

  if (edgeRows.length === 0) {
    throw new HttpError(400, "project is not linked to workspace");
  }

  return projectRecord;
}

export async function loadWorkspaceProjects(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ProjectScopeRow[]> {
  const [rows] = await surreal
    .query<[ProjectScopeRow[]]>(
      "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      {
        workspace: workspaceRecord,
      },
    )
    .collect<[ProjectScopeRow[]]>();

  return rows;
}

export function resolveEntityProject(
  entityText: string,
  promptText: string,
  projects: ProjectScopeRow[],
): RecordId<"project", string> | undefined {
  if (projects.length === 0) {
    return undefined;
  }

  if (projects.length === 1) {
    return projects[0].id;
  }

  const haystack = `${promptText}\n${entityText}`;
  const matchingProjects = projects.filter((project) => {
    const escaped = project.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
  });

  if (matchingProjects.length !== 1) {
    return undefined;
  }

  return matchingProjects[0].id;
}
