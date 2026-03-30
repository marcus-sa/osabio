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
  SkillDetailResponse,
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
// Activate skill (draft -> active)
// ---------------------------------------------------------------------------

/**
 * Transition a skill from "draft" to "active".
 * Throws HttpError(404) if skill not found in workspace.
 * Throws HttpError(409) if current status is not "draft".
 */
export async function activateSkill(
  surreal: Surreal,
  workspaceId: string,
  skillId: string,
): Promise<void> {
  const skillRecord = new RecordId("skill", skillId);

  const [rows] = await surreal.query<[Array<{ status: SkillStatus; workspace: RecordId<"workspace", string> }>]>(
    `SELECT status, workspace FROM $skill;`,
    { skill: skillRecord },
  );

  const skill = rows[0];
  if (!skill || (skill.workspace.id as string) !== workspaceId) {
    throw new HttpError(404, "skill not found in workspace");
  }

  if (skill.status !== "draft") {
    throw new HttpError(409, `skill must be in draft status to activate (current: ${skill.status})`);
  }

  await surreal.query(
    `UPDATE $skill SET status = "active", updated_at = $now;`,
    { skill: skillRecord, now: new Date() },
  );
}

// ---------------------------------------------------------------------------
// Deprecate skill (active -> deprecated)
// ---------------------------------------------------------------------------

/**
 * Transition a skill from "active" to "deprecated".
 * Throws HttpError(404) if skill not found in workspace.
 * Throws HttpError(409) if current status is not "active".
 */
export async function deprecateSkill(
  surreal: Surreal,
  workspaceId: string,
  skillId: string,
): Promise<void> {
  const skillRecord = new RecordId("skill", skillId);

  const [rows] = await surreal.query<[Array<{ status: SkillStatus; workspace: RecordId<"workspace", string> }>]>(
    `SELECT status, workspace FROM $skill;`,
    { skill: skillRecord },
  );

  const skill = rows[0];
  if (!skill || (skill.workspace.id as string) !== workspaceId) {
    throw new HttpError(404, "skill not found in workspace");
  }

  if (skill.status !== "active") {
    throw new HttpError(409, `skill must be in active status to deprecate (current: ${skill.status})`);
  }

  await surreal.query(
    `UPDATE $skill SET status = "deprecated", updated_at = $now;`,
    { skill: skillRecord, now: new Date() },
  );
}

// ---------------------------------------------------------------------------
// Get skill detail
// ---------------------------------------------------------------------------

type DetailSkillRow = {
  id: SkillRecord;
  name: string;
  description: string;
  version: string;
  status: SkillStatus;
  source: SkillSource;
  created_by: RecordId<"identity", string>;
  created_at: string | Date;
  updated_at?: string | Date;
};

type DetailToolRow = {
  tool_id: RecordId<"mcp_tool", string>;
  tool_name: string;
};

type DetailAgentRow = {
  agent_id: RecordId<"identity", string>;
  agent_name: string;
};

type DetailGovRow = {
  policy_id: RecordId<"policy", string>;
  policy_name: string;
  policy_status: string;
};

/**
 * Fetch full skill detail including required_tools, agents, and governed_by.
 *
 * Resolves edges:
 *  - skill_requires -> mcp_tool (required tools)
 *  - possesses -> skill (agents that possess the skill)
 *  - governs_skill -> skill (policies governing the skill)
 */
export async function getSkillDetail(
  surreal: Surreal,
  workspaceId: string,
  skillId: string,
): Promise<SkillDetailResponse> {
  const skillRecord = new RecordId("skill", skillId);

  const skillSql = `SELECT id, name, description, version, status, source, created_by, created_at, updated_at FROM $skill;`;
  const toolsSql = `SELECT out.id AS tool_id, out.name AS tool_name FROM skill_requires WHERE in = $skill;`;
  const agentsSql = `SELECT in.id AS agent_id, in.name AS agent_name FROM possesses WHERE out = $skill;`;
  const govSql = `SELECT in.id AS policy_id, in.title AS policy_name, in.status AS policy_status FROM governs_skill WHERE out = $skill;`;

  const [skillRows, toolRows, agentRows, govRows] = await surreal.query<
    [DetailSkillRow[], DetailToolRow[], DetailAgentRow[], DetailGovRow[]]
  >(
    `${skillSql}\n${toolsSql}\n${agentsSql}\n${govSql}`,
    { skill: skillRecord },
  );

  const skill = skillRows[0];
  if (!skill || (skill.id.id as string) !== skillId) {
    throw new HttpError(404, "skill not found");
  }

  // Verify workspace ownership
  // We need to check workspace separately since detail query selects specific fields
  const [wsRows] = await surreal.query<[Array<{ workspace: RecordId<"workspace", string> }>]>(
    `SELECT workspace FROM $skill;`,
    { skill: skillRecord },
  );
  if (!wsRows[0] || (wsRows[0].workspace.id as string) !== workspaceId) {
    throw new HttpError(404, "skill not found in workspace");
  }

  const requiredTools = toolRows.map((r) => ({
    id: r.tool_id.id as string,
    name: r.tool_name,
  }));

  const agents = agentRows.map((r) => ({
    id: r.agent_id.id as string,
    name: r.agent_name,
  }));

  const governedBy = govRows.map((r) => ({
    id: r.policy_id.id as string,
    name: r.policy_name,
    status: r.policy_status,
  }));

  return {
    skill: {
      id: skillId,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      status: skill.status,
      source: skill.source,
      required_tools: requiredTools,
      agent_count: agents.length,
      created_at: toISOString(skill.created_at),
      created_by: skill.created_by?.id as string | undefined,
      updated_at: skill.updated_at ? toISOString(skill.updated_at) : undefined,
    },
    required_tools: requiredTools,
    agents,
    governed_by: governedBy,
  };
}

// ---------------------------------------------------------------------------
// Update skill
// ---------------------------------------------------------------------------

type UpdateSkillInput = {
  name?: string;
  description?: string;
  version?: string;
  source?: SkillSource;
  required_tool_ids?: string[];
};

type UpdateSkillResult = {
  id: string;
  name: string;
  description: string;
  version: string;
  status: SkillStatus;
};

/**
 * Update a skill's metadata and optionally replace its required tools.
 *
 * If name changes, validates uniqueness within workspace.
 * If required_tool_ids provided, replaces all skill_requires edges.
 */
export async function updateSkill(
  surreal: Surreal,
  workspaceId: string,
  skillId: string,
  input: UpdateSkillInput,
): Promise<UpdateSkillResult> {
  const skillRecord = new RecordId("skill", skillId);

  // Verify skill exists in workspace
  const [rows] = await surreal.query<
    [Array<{ name: string; description: string; version: string; status: SkillStatus; workspace: RecordId<"workspace", string> }>]
  >(
    `SELECT name, description, version, status, workspace FROM $skill;`,
    { skill: skillRecord },
  );

  const existing = rows[0];
  if (!existing || (existing.workspace.id as string) !== workspaceId) {
    throw new HttpError(404, "skill not found in workspace");
  }

  // If name is changing, validate uniqueness
  if (input.name && input.name !== existing.name) {
    const workspaceRecord = new RecordId("workspace", workspaceId);
    const [dupeRows] = await surreal.query<[Array<{ id: SkillRecord }>]>(
      `SELECT id FROM skill WHERE workspace = $ws AND name = $name AND id != $skill LIMIT 1;`,
      { ws: workspaceRecord, name: input.name, skill: skillRecord },
    );
    if (dupeRows.length > 0) {
      throw new HttpError(409, `Skill name '${input.name}' is already taken in this workspace`);
    }
  }

  // Build SET clause for provided fields
  const setClauses: string[] = [];
  const bindings: Record<string, unknown> = { skill: skillRecord, now: new Date() };

  if (input.name !== undefined) {
    setClauses.push("name = $newName");
    bindings.newName = input.name;
  }
  if (input.description !== undefined) {
    setClauses.push("description = $newDesc");
    bindings.newDesc = input.description;
  }
  if (input.version !== undefined) {
    setClauses.push("version = $newVersion");
    bindings.newVersion = input.version;
  }
  if (input.source !== undefined) {
    setClauses.push("source = $newSource");
    bindings.newSource = input.source;
  }
  setClauses.push("updated_at = $now");

  const statements: string[] = [];
  statements.push(`UPDATE $skill SET ${setClauses.join(", ")};`);

  // Replace skill_requires edges if tool IDs provided
  if (input.required_tool_ids !== undefined) {
    statements.push(`DELETE skill_requires WHERE in = $skill;`);
    for (let i = 0; i < input.required_tool_ids.length; i++) {
      const toolBindKey = `tool${i}`;
      bindings[toolBindKey] = new RecordId("mcp_tool", input.required_tool_ids[i]);
      statements.push(`RELATE $skill->skill_requires->$${toolBindKey};`);
    }
  }

  await surreal.query(statements.join("\n"), bindings);

  return {
    id: skillId,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    version: input.version ?? existing.version,
    status: existing.status,
  };
}

// ---------------------------------------------------------------------------
// Delete skill
// ---------------------------------------------------------------------------

/**
 * Delete a skill and its skill_requires edges.
 *
 * Throws HttpError(404) if skill not found in workspace.
 * Throws HttpError(409) if agents possess the skill (possesses edges exist).
 */
export async function deleteSkill(
  surreal: Surreal,
  workspaceId: string,
  skillId: string,
): Promise<void> {
  const skillRecord = new RecordId("skill", skillId);

  // Verify skill exists in workspace
  const [rows] = await surreal.query<
    [Array<{ workspace: RecordId<"workspace", string> }>]
  >(
    `SELECT workspace FROM $skill;`,
    { skill: skillRecord },
  );

  const skill = rows[0];
  if (!skill || (skill.workspace.id as string) !== workspaceId) {
    throw new HttpError(404, "skill not found in workspace");
  }

  // Check for possesses edges (agents using this skill)
  const [possessRows] = await surreal.query<[Array<{ count: number }>]>(
    `SELECT count() AS count FROM possesses WHERE out = $skill GROUP ALL;`,
    { skill: skillRecord },
  );
  const possessCount = possessRows[0]?.count ?? 0;
  if (possessCount > 0) {
    throw new HttpError(409, `cannot delete skill: ${possessCount} agent(s) currently possess this skill`);
  }

  // Delete skill_requires edges and the skill record
  await surreal.query(
    `DELETE skill_requires WHERE in = $skill;\nDELETE $skill;`,
    { skill: skillRecord },
  );
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
