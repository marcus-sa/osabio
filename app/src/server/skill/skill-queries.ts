/**
 * Skill Query Functions
 *
 * SurrealDB queries for the skill catalog module: create with
 * tool-requirement edges, and list with optional status filter.
 *
 * All functions take `surreal` as first parameter (dependency injection).
 * No module-level singletons or mutable state.
 */
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { HttpError } from "../http/errors";
import type {
  CreateSkillInput,
  SkillListItem,
  SkillRecord,
  SkillSource,
  SkillStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Create skill
// ---------------------------------------------------------------------------

type CreateSkillResult = {
  id: string;
  name: string;
  status: SkillStatus;
};

/**
 * Create a skill record with optional skill_requires edges.
 *
 * Steps:
 * 1. Validate name uniqueness within workspace (app-layer check)
 * 2. CREATE skill record with status "draft"
 * 3. RELATE skill -> skill_requires -> mcp_tool for each required tool
 */
export async function createSkill(
  surreal: Surreal,
  workspaceId: string,
  input: CreateSkillInput,
  identityId: string,
): Promise<CreateSkillResult> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  // Pre-validate name uniqueness
  const [existingRows] = await surreal.query<[Array<{ id: SkillRecord }>]>(
    `SELECT id FROM skill WHERE workspace = $ws AND name = $name LIMIT 1;`,
    { ws: workspaceRecord, name: input.name },
  );

  if (existingRows.length > 0) {
    throw new HttpError(409, `Skill name '${input.name}' is already taken in this workspace`);
  }

  const skillId = randomUUID();
  const skillRecord = new RecordId("skill", skillId);
  const identityRecord = new RecordId("identity", identityId);
  const now = new Date();

  // Build batch: CREATE skill + RELATE edges
  const statements: string[] = [];
  const bindings: Record<string, unknown> = {
    skillRecord,
    wsRecord: workspaceRecord,
    skillName: input.name,
    skillDescription: input.description,
    skillVersion: input.version,
    skillSource: input.source,
    identityRecord,
    now,
  };

  statements.push(
    `CREATE $skillRecord CONTENT {
      name: $skillName,
      description: $skillDescription,
      version: $skillVersion,
      status: "draft",
      workspace: $wsRecord,
      source: $skillSource,
      created_by: $identityRecord,
      created_at: $now
    };`,
  );

  // Create skill_requires edges for each required tool
  const toolIds = input.required_tool_ids ?? [];
  for (let i = 0; i < toolIds.length; i++) {
    const toolBindKey = `tool${i}`;
    bindings[toolBindKey] = new RecordId("mcp_tool", toolIds[i]);
    statements.push(
      `RELATE $skillRecord->skill_requires->$${toolBindKey};`,
    );
  }

  await surreal.query(statements.join("\n"), bindings);

  return {
    id: skillId,
    name: input.name,
    status: "draft",
  };
}

// ---------------------------------------------------------------------------
// List skills
// ---------------------------------------------------------------------------

type SkillRow = {
  id: SkillRecord;
  name: string;
  description: string;
  version: string;
  status: SkillStatus;
  source: SkillSource;
  created_at: string | Date;
};

type RequiredToolRow = {
  skill_id: SkillRecord;
  tool_id: RecordId<"mcp_tool", string>;
  tool_name: string;
};

type AgentCountRow = {
  skill_id: SkillRecord;
  agent_count: number;
};

/**
 * List skills in a workspace with optional status filter.
 *
 * Each list item includes required_tools and agent_count via
 * graph traversal of skill_requires and possesses edges.
 */
export async function listSkills(
  surreal: Surreal,
  workspaceId: string,
  status?: SkillStatus,
): Promise<SkillListItem[]> {
  const workspaceRecord = new RecordId("workspace", workspaceId);

  const statusClause = status ? "AND status = $status" : "";
  const bindings: Record<string, unknown> = { ws: workspaceRecord };
  if (status) bindings.status = status;

  // Query skills, required tools, and agent counts in one round-trip
  const skillsSql = [
    "SELECT id, name, description, version, status, source, created_at",
    "FROM skill",
    "WHERE workspace = $ws",
    statusClause,
    "ORDER BY created_at DESC;",
  ].filter(Boolean).join(" ");

  const toolsSql = [
    "SELECT in.id AS skill_id, out.id AS tool_id, out.name AS tool_name",
    "FROM skill_requires",
    "WHERE in.workspace = $ws",
    statusClause ? "AND in.status = $status" : "",
    ";",
  ].filter(Boolean).join(" ");

  const agentCountSql = [
    "SELECT out.id AS skill_id, count() AS agent_count",
    "FROM possesses",
    "WHERE out.workspace = $ws",
    statusClause ? "AND out.status = $status" : "",
    "GROUP BY skill_id;",
  ].filter(Boolean).join(" ");

  const results = await surreal.query<[SkillRow[], RequiredToolRow[], AgentCountRow[]]>(
    `${skillsSql}\n${toolsSql}\n${agentCountSql}`,
    bindings,
  );

  const [skillRows, toolRows, agentCountRows] = results;

  // Build lookup maps
  const toolsBySkill = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of toolRows) {
    const skillId = row.skill_id.id as string;
    const tools = toolsBySkill.get(skillId) ?? [];
    tools.push({ id: row.tool_id.id as string, name: row.tool_name });
    toolsBySkill.set(skillId, tools);
  }

  const agentCountBySkill = new Map<string, number>();
  for (const row of agentCountRows) {
    agentCountBySkill.set(row.skill_id.id as string, row.agent_count);
  }

  return skillRows.map((row) => toSkillListItem(row, toolsBySkill, agentCountBySkill));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toSkillListItem(
  row: SkillRow,
  toolsBySkill: Map<string, Array<{ id: string; name: string }>>,
  agentCountBySkill: Map<string, number>,
): SkillListItem {
  const skillId = row.id.id as string;
  return {
    id: skillId,
    name: row.name,
    description: row.description,
    version: row.version,
    status: row.status,
    source: row.source,
    required_tools: toolsBySkill.get(skillId) ?? [],
    agent_count: agentCountBySkill.get(skillId) ?? 0,
    created_at: toISOString(row.created_at),
  };
}

function toISOString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
