/**
 * Walking Skeleton: Skills Feature E2E
 *
 * Traces: US-01 (CRUD), US-03 (lifecycle), US-07 (agent creation with skills)
 *
 * These are the minimum viable E2E paths through the skills system.
 * Skeleton 1: Admin creates skill, activates it, and sees it in workspace catalog
 * Skeleton 2: Admin creates agent with skills and verifies effective toolset
 * Skeleton 3: Skill lifecycle governs agent creation visibility
 *
 * Together they prove:
 * - Skill table works (create, activate, list)
 * - skill_requires edges work (tools linked to skills)
 * - Agent creation transaction extended with possesses edges
 * - Effective toolset resolution via graph traversal
 * - Lifecycle transitions control skill availability
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/skills              (create skill)
 *   POST /api/workspaces/:wsId/skills/:id/activate  (activate)
 *   GET  /api/workspaces/:wsId/skills               (list skills)
 *   POST /api/workspaces/:wsId/agents               (create agent)
 *   POST /api/workspaces/:wsId/skills/:id/deprecate  (deprecate)
 */
import { describe, expect, it } from "bun:test";
import {
  setupSkillSuite,
  createTestUser,
  createTestWorkspace,
  linkUserToWorkspaceIdentity,
  createSkillViaHttp,
  activateSkillViaHttp,
  deprecateSkillViaHttp,
  listSkillsViaHttp,
  createAgentViaHttp,
  seedMcpTools,
  makeSkillInput,
  resolveSkillDerivedTools,
  countPossessesEdges,
  type SkillListItem,
} from "./skill-test-kit";

const getRuntime = setupSkillSuite("walking_skeleton");

describe("Walking Skeleton 1: Admin creates skill, activates it, and sees it in catalog", () => {
  // ---------------------------------------------------------------------------
  // WS-1: Create -> Activate -> List
  // US-01 + US-03
  // ---------------------------------------------------------------------------
  it("admin registers a security audit skill and makes it available for agent assignment", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where an admin manages agent expertise
    const user = await createTestUser(baseUrl, `ws1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ws1-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // And the workspace has tools that the skill will require
    const tools = await seedMcpTools(surreal, workspaceId, [
      "read_file",
      "search_codebase",
      "check_dependencies",
    ]);

    // When the admin creates a skill with source reference and required tools
    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
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
    }));

    // Then the skill is created with draft status
    if (createRes.status !== 201) {
      const errBody = await createRes.text();
      console.error("CREATE SKILL ERROR:", createRes.status, errBody);
    }
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { skill: { id: string; status: string } };
    expect(created.skill.status).toBe("draft");
    const skillId = created.skill.id;

    // When the admin activates the skill
    const activateRes = await activateSkillViaHttp(baseUrl, user, workspaceId, skillId);
    expect(activateRes.status).toBe(200);

    // Then the skill appears in the workspace catalog as active
    const listRes = await listSkillsViaHttp(baseUrl, user, workspaceId, "active");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { skills: SkillListItem[] };
    const found = listed.skills.find((s) => s.name === "security-audit");
    expect(found).toBeDefined();
    expect(found!.status).toBe("active");
    expect(found!.version).toBe("1.0");
  }, 120_000);
});

describe("Walking Skeleton 2: Admin creates agent with skills and verifies effective toolset", () => {
  // ---------------------------------------------------------------------------
  // WS-2: Create skill + Create agent with skill -> Verify possesses + tools
  // US-01 + US-07 + Toolset resolution
  // ---------------------------------------------------------------------------
  it("agent created with skills gains access to skill-derived tools", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active skill requiring specific tools
    const user = await createTestUser(baseUrl, `ws2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ws2-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const tools = await seedMcpTools(surreal, workspaceId, [
      "read_file",
      "search_codebase",
      "run_linter",
    ]);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "code-review",
      description: "Code quality and maintainability review",
      version: "2.0",
      source: {
        type: "github",
        source: "acme-corp/agent-skills",
        ref: "v2.0",
        subpath: "skills/code-review",
      },
      required_tool_ids: tools.map((t) => t.id),
    }));
    expect(createRes.status).toBe(201);
    const { skill } = (await createRes.json()) as { skill: { id: string } };

    const activateRes = await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);
    expect(activateRes.status).toBe(200);

    // When the admin creates an agent with this skill
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `code-reviewer-${crypto.randomUUID().slice(0, 8)}`,
      description: "Reviews code quality",
      runtime: "external",
      skill_ids: [skill.id],
    });

    // Then the agent is created successfully
    expect(agentRes.status).toBe(201);
    const agentBody = (await agentRes.json()) as { agent: { identity_id: string } };
    const identityId = agentBody.agent.identity_id;

    // And the agent possesses the assigned skill
    const possessesCount = await countPossessesEdges(surreal, identityId);
    expect(possessesCount).toBe(1);

    // And the agent's effective toolset includes all skill-derived tools
    const derivedTools = await resolveSkillDerivedTools(surreal, identityId);
    const toolNames = derivedTools.map((t) => t.tool_name).sort();
    expect(toolNames).toEqual(["read_file", "run_linter", "search_codebase"]);
  }, 120_000);
});

describe("Walking Skeleton 3: Skill lifecycle governs agent creation visibility", () => {
  // ---------------------------------------------------------------------------
  // WS-3: Lifecycle transitions control availability
  // US-03 + US-07
  // ---------------------------------------------------------------------------
  it("deprecated skill is excluded from active skill listing used during agent creation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active skill
    const user = await createTestUser(baseUrl, `ws3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ws3-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "legacy-migration",
      description: "Database migration with rollback support",
      version: "0.9",
    }));
    expect(createRes.status).toBe(201);
    const { skill } = (await createRes.json()) as { skill: { id: string } };

    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // And the skill appears in the active catalog
    const beforeRes = await listSkillsViaHttp(baseUrl, user, workspaceId, "active");
    const beforeList = (await beforeRes.json()) as { skills: SkillListItem[] };
    expect(beforeList.skills.some((s) => s.name === "legacy-migration")).toBe(true);

    // When the admin deprecates the skill
    const deprecateRes = await deprecateSkillViaHttp(baseUrl, user, workspaceId, skill.id);
    expect(deprecateRes.status).toBe(200);

    // Then the skill no longer appears in the active catalog
    const afterRes = await listSkillsViaHttp(baseUrl, user, workspaceId, "active");
    const afterList = (await afterRes.json()) as { skills: SkillListItem[] };
    expect(afterList.skills.some((s) => s.name === "legacy-migration")).toBe(false);

    // And it still appears in the full catalog as deprecated
    const allRes = await listSkillsViaHttp(baseUrl, user, workspaceId);
    const allList = (await allRes.json()) as { skills: SkillListItem[] };
    const deprecatedSkill = allList.skills.find((s) => s.name === "legacy-migration");
    expect(deprecatedSkill).toBeDefined();
    expect(deprecatedSkill!.status).toBe("deprecated");
  }, 120_000);
});
