import { tool } from "ai";
import { RecordId, Surreal } from "surrealdb";
import { z } from "zod";
import {
  listWorkspaceProjectSummaries,
  listWorkspaceRecentDecisions,
  listWorkspaceOpenQuestions,
  resolveWorkspaceProjectRecord,
} from "../../graph/queries";
import { listWorkspaceOpenObservations } from "../../observation/queries";
import { requireToolContext } from "./helpers";
import type { ChatToolDeps } from "./types";

const entityKindEnum = z.enum(["project", "feature", "task", "decision", "question", "observation"]);

export function createListWorkspaceEntitiesTool(deps: ChatToolDeps) {
  return tool({
    description:
      "List workspace entities by kind. Use this to answer questions about what entities exist (e.g. \"what decisions are there?\", \"list open questions\", \"show all tasks\"). For semantic search by topic, use search_entities instead.",
    inputSchema: z.object({
      kind: entityKindEnum.describe("Entity kind to list."),
      status: z.string().optional().describe("Optional status filter, e.g. 'provisional', 'confirmed', 'open', 'done'."),
      project: z.string().optional().describe("Optional project name or ID to scope results. Only use when the user explicitly mentions a project."),
      limit: z.number().int().min(1).max(50).default(25).describe("Maximum number of results."),
    }),
    execute: async (input, options) => {
      const context = requireToolContext(options);

      const projectRecord = input.project
        ? await resolveWorkspaceProjectRecord({
            surreal: deps.surreal,
            workspaceRecord: context.workspaceRecord,
            projectInput: input.project,
          })
        : undefined;

      if (input.kind === "project") {
        const projects = await listWorkspaceProjectSummaries({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          limit: input.limit,
        });
        return {
          kind: "project",
          count: projects.length,
          entities: projects.map((p) => ({
            id: `project:${p.id}`,
            name: p.name,
            activeTaskCount: p.activeTaskCount,
          })),
        };
      }

      if (input.kind === "task") {
        return listTasks(deps.surreal, context.workspaceRecord, projectRecord, input.status, input.limit);
      }

      if (input.kind === "feature") {
        return listFeatures(deps.surreal, context.workspaceRecord, projectRecord, input.status, input.limit);
      }

      if (input.kind === "decision") {
        const decisions = await listWorkspaceRecentDecisions({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          limit: input.limit,
        });
        const filtered = input.status
          ? decisions.filter((d) => d.status === input.status)
          : decisions;
        return {
          kind: "decision",
          count: filtered.length,
          entities: filtered.map((d) => ({
            id: `decision:${d.id}`,
            name: d.name,
            status: d.status,
            ...(d.priority ? { priority: d.priority } : {}),
            ...(d.project ? { project: d.project } : {}),
          })),
        };
      }

      if (input.kind === "question") {
        const questions = await listWorkspaceOpenQuestions({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          limit: input.limit,
        });
        return {
          kind: "question",
          count: questions.length,
          entities: questions.map((q) => ({
            id: `question:${q.id}`,
            name: q.name,
            ...(q.priority ? { priority: q.priority } : {}),
            ...(q.project ? { project: q.project } : {}),
          })),
        };
      }

      if (input.kind === "observation") {
        const observations = await listWorkspaceOpenObservations({
          surreal: deps.surreal,
          workspaceRecord: context.workspaceRecord,
          limit: input.limit,
        });
        return {
          kind: "observation",
          count: observations.length,
          entities: observations.map((o) => ({
            id: `observation:${o.id}`,
            text: o.text,
            severity: o.severity,
            status: o.status,
            ...(o.category ? { category: o.category } : {}),
            sourceAgent: o.sourceAgent,
          })),
        };
      }

      throw new Error(`unsupported entity kind: ${input.kind}`);
    },
  });
}

async function listTasks(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string> | undefined,
  status: string | undefined,
  limit: number,
) {
  const conditions = ["workspace = $workspace"];
  const params: Record<string, unknown> = { workspace: workspaceRecord, limit };

  if (projectRecord) {
    conditions.push(
      "(id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)"
      + " OR id IN (SELECT VALUE out FROM has_task WHERE `in` IN (SELECT VALUE out FROM has_feature WHERE `in` = $project)))",
    );
    params.project = projectRecord;
  }

  if (status) {
    conditions.push("status = $status");
    params.status = status;
  }

  const query = [
    "SELECT id, title, status, priority, created_at",
    "FROM task",
    `WHERE ${conditions.join(" AND ")}`,
    "ORDER BY created_at DESC",
    "LIMIT $limit;",
  ].join(" ");

  const [rows] = await surreal
    .query<[Array<{ id: RecordId<"task", string>; title: string; status: string; priority?: string; created_at: string | Date }>]>(query, params)
    .collect<[Array<{ id: RecordId<"task", string>; title: string; status: string; priority?: string; created_at: string | Date }>]>();

  return {
    kind: "task",
    count: rows.length,
    entities: rows.map((t) => ({
      id: `task:${(t.id.id as string)}`,
      name: t.title,
      status: t.status,
      ...(t.priority ? { priority: t.priority } : {}),
    })),
  };
}

async function listFeatures(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string> | undefined,
  status: string | undefined,
  limit: number,
) {
  const conditions = ["workspace = $workspace"];
  const params: Record<string, unknown> = { workspace: workspaceRecord, limit };

  if (projectRecord) {
    conditions.push("id IN (SELECT VALUE out FROM has_feature WHERE `in` = $project)");
    params.project = projectRecord;
  }

  if (status) {
    conditions.push("status = $status");
    params.status = status;
  }

  const query = [
    "SELECT id, name, status, created_at",
    "FROM feature",
    `WHERE ${conditions.join(" AND ")}`,
    "ORDER BY created_at DESC",
    "LIMIT $limit;",
  ].join(" ");

  const [rows] = await surreal
    .query<[Array<{ id: RecordId<"feature", string>; name: string; status: string; created_at: string | Date }>]>(query, params)
    .collect<[Array<{ id: RecordId<"feature", string>; name: string; status: string; created_at: string | Date }>]>();

  return {
    kind: "feature",
    count: rows.length,
    entities: rows.map((f) => ({
      id: `feature:${(f.id.id as string)}`,
      name: f.name,
      status: f.status,
    })),
  };
}
