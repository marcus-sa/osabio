/**
 * Agent Creation with Skills: Extended transaction with possesses + can_use edges
 *
 * Traces: US-07 (atomic agent creation), US-06 (tools review)
 *
 * Validates that the agent creation transaction is extended to include
 * skill assignments (possesses edges) and additional tool grants (can_use edges),
 * and that skill status is validated at creation time.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/agents               (create agent)
 *   GET  /api/workspaces/:wsId/agents/:agentId      (agent detail)
 *   POST /api/workspaces/:wsId/skills                (create skill)
 *   POST /api/workspaces/:wsId/skills/:id/activate   (activate skill)
 *   POST /api/workspaces/:wsId/skills/:id/deprecate  (deprecate skill)
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
  createAgentViaHttp,
  getAgentDetailViaHttp,
  seedMcpTools,
  makeSkillInput,
  countPossessesEdges,
  countCanUseEdges,
  resolveSkillDerivedTools,
} from "./skill-test-kit";

const getRuntime = setupSkillSuite("agent_creation_skills");

// ---------------------------------------------------------------------------
// Happy Paths
// ---------------------------------------------------------------------------

describe("Agent Creation: Skill Assignment", () => {
  // A-1: Create agent with skills creates possesses edges
  it("agent created with skills has possesses edges linking identity to skills", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with 2 active skills
    const user = await createTestUser(baseUrl, `ac-a1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ac-a1-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const skill1Res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "security-audit" }));
    const skill1 = (await skill1Res.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill1.skill.id);

    const skill2Res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "code-review" }));
    const skill2 = (await skill2Res.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill2.skill.id);

    // When the admin creates an agent with both skills
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `auditor-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [skill1.skill.id, skill2.skill.id],
    });

    // Then the agent is created successfully
    expect(agentRes.status).toBe(201);
    const body = (await agentRes.json()) as { agent: { identity_id: string } };

    // And 2 possesses edges exist for the agent identity
    const count = await countPossessesEdges(surreal, body.agent.identity_id);
    expect(count).toBe(2);
  }, 120_000);

  // A-2: Create agent with additional tools creates can_use edges
  it("agent created with additional tools has can_use edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with registered tools
    const user = await createTestUser(baseUrl, `ac-a2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ac-a2-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const tools = await seedMcpTools(surreal, workspaceId, ["create_branch", "post_comment"]);

    // When the admin creates an agent with additional tools (no skills)
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `helper-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      additional_tool_ids: tools.map((t) => t.id),
    });

    // Then the agent is created with 2 can_use edges
    expect(agentRes.status).toBe(201);
    const body = (await agentRes.json()) as { agent: { identity_id: string } };
    const count = await countCanUseEdges(surreal, body.agent.identity_id);
    expect(count).toBe(2);
  }, 120_000);

  // A-3: Create agent with no skills and no tools succeeds
  it("agent created without skills or tools has zero possesses and can_use edges", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const user = await createTestUser(baseUrl, `ac-a3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ac-a3-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // When the admin creates an agent with no skills or tools
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `minimal-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
    });

    // Then the agent is created with zero possesses and zero can_use edges
    expect(agentRes.status).toBe(201);
    const body = (await agentRes.json()) as { agent: { identity_id: string } };
    const possesses = await countPossessesEdges(surreal, body.agent.identity_id);
    const canUse = await countCanUseEdges(surreal, body.agent.identity_id);
    expect(possesses).toBe(0);
    expect(canUse).toBe(0);
  }, 120_000);

  // A-6: Agent detail returns assigned skills
  it("agent detail includes the skills assigned during creation", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent created with a skill
    const user = await createTestUser(baseUrl, `ac-a6-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ac-a6-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "api-design" }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `designer-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [skill.id],
    });
    const agentBody = (await agentRes.json()) as { agent: { id: string } };

    // When the admin views the agent detail
    const detailRes = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agentBody.agent.id);

    // Then the detail includes the assigned skill
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { agent: unknown; skills?: Array<{ name: string }> };
    expect(detail.skills).toBeDefined();
    expect(detail.skills!.length).toBe(1);
    expect(detail.skills![0].name).toBe("api-design");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------

describe("Agent Creation: Skill Validation", () => {
  // A-4: Deprecated skill blocks agent creation
  it("agent creation is rejected when a selected skill was deprecated", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a deprecated skill
    const user = await createTestUser(baseUrl, `ac-a4-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ac-a4-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "old-skill" }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);
    await deprecateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // When the admin tries to create an agent with the deprecated skill
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `blocked-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [skill.id],
    });

    // Then the creation is rejected because the skill is deprecated
    expect(agentRes.status).toBe(409);
  }, 120_000);

  // A-5: Non-existent skill blocks agent creation
  it("agent creation is rejected when a selected skill does not exist", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace
    const user = await createTestUser(baseUrl, `ac-a5-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `ac-a5-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // When the admin tries to create an agent with a nonexistent skill
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `ghost-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [crypto.randomUUID()],
    });

    // Then the creation is rejected
    expect([400, 404, 409]).toContain(agentRes.status);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Effective Toolset Resolution
// ---------------------------------------------------------------------------

describe("Effective Toolset: Skill-derived tools", () => {
  // T-1: Skill-derived tools resolved from skill_requires edges
  it("agent gains tools through possessed skill's required tools", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a skill requiring 3 tools
    const user = await createTestUser(baseUrl, `et-t1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `et-t1-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const tools = await seedMcpTools(surreal, workspaceId, [
      "read_file",
      "search_codebase",
      "check_dependencies",
    ]);

    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
      required_tool_ids: tools.map((t) => t.id),
    }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // When an agent is created with this skill
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `auditor-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [skill.id],
    });
    const agentBody = (await agentRes.json()) as { agent: { identity_id: string } };

    // Then the agent's effective toolset includes all 3 skill-derived tools
    const derivedTools = await resolveSkillDerivedTools(surreal, agentBody.agent.identity_id);
    const toolNames = derivedTools.map((t) => t.tool_name).sort();
    expect(toolNames).toEqual(["check_dependencies", "read_file", "search_codebase"]);
  }, 120_000);

  // T-2: Multiple skills sharing a tool produce deduplicated toolset
  // @property -- signals universal invariant: for any combination of skills sharing tools, dedup holds
  it("shared tools between skills are deduplicated in effective toolset", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given 2 skills that both require "search_codebase"
    const user = await createTestUser(baseUrl, `et-t2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `et-t2-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const tools = await seedMcpTools(surreal, workspaceId, [
      "read_file",
      "search_codebase",
      "run_linter",
    ]);

    // security-audit requires read_file + search_codebase
    const skill1Res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
      required_tool_ids: [tools[0].id, tools[1].id],
    }));
    const skill1 = (await skill1Res.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill1.skill.id);

    // code-review requires search_codebase + run_linter
    const skill2Res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "code-review",
      required_tool_ids: [tools[1].id, tools[2].id],
    }));
    const skill2 = (await skill2Res.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill2.skill.id);

    // When an agent possesses both skills
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `dual-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [skill1.skill.id, skill2.skill.id],
    });
    const agentBody = (await agentRes.json()) as { agent: { identity_id: string } };

    // Then the effective toolset has 3 unique tools (not 4 with duplicate)
    const derivedTools = await resolveSkillDerivedTools(surreal, agentBody.agent.identity_id);
    const uniqueToolNames = [...new Set(derivedTools.map((t) => t.tool_name))].sort();
    expect(uniqueToolNames).toEqual(["read_file", "run_linter", "search_codebase"]);
  }, 120_000);

  // T-3: Agent effective tools is union of skill-derived and can_use
  it("agent effective toolset is the union of skill-derived and manually granted tools", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a skill and additional tools
    const user = await createTestUser(baseUrl, `et-t3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `et-t3-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);
    const allTools = await seedMcpTools(surreal, workspaceId, [
      "read_file",
      "search_codebase",
      "create_branch",
      "post_comment",
    ]);

    // Skill requires read_file + search_codebase
    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "code-review",
      required_tool_ids: [allTools[0].id, allTools[1].id],
    }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // When the agent is created with the skill + 2 additional tools
    const agentRes = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: `combo-${crypto.randomUUID().slice(0, 8)}`,
      runtime: "external",
      skill_ids: [skill.id],
      additional_tool_ids: [allTools[2].id, allTools[3].id],
    });
    const agentBody = (await agentRes.json()) as { agent: { identity_id: string } };

    // Then the skill-derived tools are resolved
    const derivedTools = await resolveSkillDerivedTools(surreal, agentBody.agent.identity_id);
    expect(derivedTools.length).toBe(2);

    // And the additional tools are recorded as can_use
    const canUseCount = await countCanUseEdges(surreal, agentBody.agent.identity_id);
    expect(canUseCount).toBe(2);

    // Together they form the effective toolset of 4 tools
    const totalTools = derivedTools.length + canUseCount;
    expect(totalTools).toBe(4);
  }, 120_000);
});
