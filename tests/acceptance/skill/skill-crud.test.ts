/**
 * Skill CRUD: Create, Read, Update, Delete, List
 *
 * Traces: US-01 (schema + CRUD API)
 *
 * Validates that workspace admins can manage the skill catalog through
 * the HTTP API. Covers happy paths, error paths, and edge cases for
 * all CRUD operations.
 *
 * Driving ports:
 *   POST   /api/workspaces/:wsId/skills              (create)
 *   GET    /api/workspaces/:wsId/skills               (list)
 *   GET    /api/workspaces/:wsId/skills/:skillId      (detail)
 *   PUT    /api/workspaces/:wsId/skills/:skillId      (update)
 *   DELETE /api/workspaces/:wsId/skills/:skillId      (delete)
 */
import { describe, expect, it } from "bun:test";
import {
  setupSkillSuite,
  createTestUser,
  createTestWorkspace,
  linkUserToWorkspaceIdentity,
  createSkillViaHttp,
  listSkillsViaHttp,
  getSkillDetailViaHttp,
  updateSkillViaHttp,
  deleteSkillViaHttp,
  activateSkillViaHttp,
  seedMcpTools,
  makeSkillInput,
  countSkillRequiresEdges,
  getSkillFromDb,
  type SkillListItem,
  type SkillDetailResponse,
} from "./skill-test-kit";

const getRuntime = setupSkillSuite("skill_crud");

// ---------------------------------------------------------------------------
// Happy Paths
// ---------------------------------------------------------------------------

describe("Skill CRUD: Create", () => {
  // C-1: Create skill with source reference and required tools
  it("admin creates skill with GitHub source and required tools", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with registered tools
    const user = await createTestUser(baseUrl, `crud-c1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c1-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const tools = await seedMcpTools(surreal, workspaceId, [
      "read_file",
      "search_codebase",
      "check_dependencies",
    ]);

    // When the admin creates a skill with source reference and required tools
    const res = await createSkillViaHttp(baseUrl, user, workspaceId, {
      name: "security-audit",
      description: "Comprehensive security audits of code changes",
      version: "1.0",
      source: {
        type: "github",
        source: "acme-corp/agent-skills",
        ref: "v1.0",
        subpath: "skills/security-audit",
      },
      required_tool_ids: tools.map((t) => t.id),
    });

    // Then the skill is created with draft status
    expect(res.status).toBe(201);
    const body = (await res.json()) as { skill: { id: string; name: string; status: string } };
    expect(body.skill.name).toBe("security-audit");
    expect(body.skill.status).toBe("draft");

    // And 3 skill_requires edges link the skill to the specified tools
    const edgeCount = await countSkillRequiresEdges(surreal, body.skill.id);
    expect(edgeCount).toBe(3);
  }, 120_000);

  // C-11: Skill created with no required tools has zero skill_requires edges
  it("admin creates skill with no required tools", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const user = await createTestUser(baseUrl, `crud-c11-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c11-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // When the admin creates a skill without specifying required tools
    const res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "general-knowledge",
      description: "General domain knowledge without specific tool needs",
    }));

    // Then the skill is created with zero skill_requires edges
    expect(res.status).toBe(201);
    const body = (await res.json()) as { skill: { id: string } };
    const edgeCount = await countSkillRequiresEdges(surreal, body.skill.id);
    expect(edgeCount).toBe(0);
  }, 120_000);
});

describe("Skill CRUD: List", () => {
  // C-2: List workspace skills
  it("admin lists all skills in the workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with 2 skills (1 draft, 1 will be activated)
    const user = await createTestUser(baseUrl, `crud-c2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c2-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "skill-alpha" }));
    await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "skill-beta" }));

    // When the admin lists all skills
    const res = await listSkillsViaHttp(baseUrl, user, workspaceId);

    // Then both skills are returned
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: SkillListItem[] };
    expect(body.skills.length).toBe(2);
    const names = body.skills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-alpha", "skill-beta"]);
  }, 120_000);

  // C-3: List skills filtered by status
  it("admin lists skills filtered by active status", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with 1 active and 1 draft skill
    const user = await createTestUser(baseUrl, `crud-c3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c3-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const draftRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "draft-skill" }));
    const activeRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "active-skill" }));
    const activeSkill = (await activeRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, activeSkill.skill.id);

    // When the admin filters to active skills
    const res = await listSkillsViaHttp(baseUrl, user, workspaceId, "active");

    // Then only the active skill is returned
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: SkillListItem[] };
    expect(body.skills.length).toBe(1);
    expect(body.skills[0].name).toBe("active-skill");
    expect(body.skills[0].status).toBe("active");
  }, 120_000);
});

describe("Skill CRUD: Detail", () => {
  // C-4: Skill detail with tools, agents, governance
  it("admin retrieves skill detail with required tools and governance info", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a skill that has required tools
    const user = await createTestUser(baseUrl, `crud-c4-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c4-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const tools = await seedMcpTools(surreal, workspaceId, ["read_file", "search_codebase"]);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "api-design",
      description: "REST and GraphQL API design to OpenAPI standards",
      version: "1.1",
      required_tool_ids: tools.map((t) => t.id),
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };

    // When the admin views the skill detail
    const res = await getSkillDetailViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the detail includes skill metadata and required tools
    expect(res.status).toBe(200);
    const detail = (await res.json()) as SkillDetailResponse;
    expect(detail.skill.name).toBe("api-design");
    expect(detail.skill.version).toBe("1.1");
    expect(detail.required_tools.length).toBe(2);
    const toolNames = detail.required_tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(["read_file", "search_codebase"]);
  }, 120_000);
});

describe("Skill CRUD: Update", () => {
  // C-5: Update skill metadata and version
  it("admin updates skill description and version", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a skill with version 1.0
    const user = await createTestUser(baseUrl, `crud-c5-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c5-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
      version: "1.0",
      description: "Basic security audits",
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };

    // When the admin updates the version and description
    const updateRes = await updateSkillViaHttp(baseUrl, user, workspaceId, skill.id, {
      version: "1.1",
      description: "Enhanced security audits with SAST integration",
    });

    // Then the skill reflects the new version and description
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { skill: { version: string; description: string } };
    expect(updated.skill.version).toBe("1.1");
    expect(updated.skill.description).toBe("Enhanced security audits with SAST integration");

    // And updated_at is set
    const dbRecord = await getSkillFromDb(surreal, skill.id);
    expect(dbRecord?.updated_at).toBeDefined();
  }, 120_000);
});

describe("Skill CRUD: Delete", () => {
  // C-6: Delete skill with no agent assignments
  it("admin deletes an unassigned skill", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a skill with no agent assignments
    const user = await createTestUser(baseUrl, `crud-c6-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c6-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const tools = await seedMcpTools(surreal, workspaceId, ["read_file"]);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "to-delete",
      required_tool_ids: tools.map((t) => t.id),
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };

    // When the admin deletes the skill
    const deleteRes = await deleteSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the skill is removed
    expect(deleteRes.status).toBe(200);

    // And its skill_requires edges are also removed
    const edgeCount = await countSkillRequiresEdges(surreal, skill.id);
    expect(edgeCount).toBe(0);

    // And it no longer appears in the skill list
    const listRes = await listSkillsViaHttp(baseUrl, user, workspaceId);
    const listed = (await listRes.json()) as { skills: SkillListItem[] };
    expect(listed.skills.some((s) => s.name === "to-delete")).toBe(false);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------

describe("Skill CRUD: Error Paths", () => {
  // C-7: Duplicate skill name within workspace is rejected
  it("workspace rejects duplicate skill name", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an existing skill
    const user = await createTestUser(baseUrl, `crud-c7-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c7-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
    }));

    // When the admin creates another skill with the same name
    const res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
    }));

    // Then the request is rejected as a conflict
    expect(res.status).toBe(409);
  }, 120_000);

  // C-8: Creating skill with missing required fields is rejected
  it("skill creation rejects missing required fields", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const user = await createTestUser(baseUrl, `crud-c8-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c8-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // When the admin submits a skill without a name
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        description: "Missing name field",
        version: "1.0",
        source: { type: "github", source: "repo" },
      }),
    });

    // Then the request is rejected with a validation error
    expect(res.status).toBe(400);
  }, 120_000);

  // C-9: Deleting skill that is assigned to agents is rejected
  it("skill deletion is rejected when agents possess the skill", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active skill assigned to an agent
    const user = await createTestUser(baseUrl, `crud-c9-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c9-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "assigned-skill",
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // And an agent identity possesses this skill (direct edge creation
    // since agent creation route does not yet wire skill_ids to possesses edges)
    const { RecordId } = await import("surrealdb");
    const agentIdentityId = crypto.randomUUID();
    const agentIdentityRecord = new RecordId("identity", agentIdentityId);
    const skillRecord = new RecordId("skill", skill.id);
    await surreal.query(
      `CREATE $identity CONTENT { name: "test-agent", type: "agent", workspace: $ws, created_at: time::now() };
       RELATE $identity->possesses->$skill SET granted_at = time::now();`,
      {
        identity: agentIdentityRecord,
        ws: new RecordId("workspace", workspaceId),
        skill: skillRecord,
      },
    );

    // When the admin tries to delete the skill
    const deleteRes = await deleteSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the deletion is rejected because agents depend on it
    expect([400, 409]).toContain(deleteRes.status);
  }, 120_000);

  // C-10: Skill not found returns proper error
  it("retrieving a nonexistent skill returns not found", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const user = await createTestUser(baseUrl, `crud-c10-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `crud-c10-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // When the admin requests a skill that does not exist
    const res = await getSkillDetailViaHttp(baseUrl, user, workspaceId, crypto.randomUUID());

    // Then a not found error is returned
    expect(res.status).toBe(404);
  }, 120_000);
});
