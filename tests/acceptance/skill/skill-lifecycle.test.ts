/**
 * Skill Lifecycle: draft -> active -> deprecated transitions
 *
 * Traces: US-03 (lifecycle management)
 *
 * Validates that skill lifecycle transitions follow the correct state
 * machine and enforce valid transitions only.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/skills/:skillId/activate   (draft -> active)
 *   POST /api/workspaces/:wsId/skills/:skillId/deprecate  (active -> deprecated)
 *   GET  /api/workspaces/:wsId/skills                     (list with status filter)
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
  getSkillFromDb,
  makeSkillInput,
  type SkillListItem,
} from "./skill-test-kit";

const getRuntime = setupSkillSuite("skill_lifecycle");

// ---------------------------------------------------------------------------
// Happy Paths
// ---------------------------------------------------------------------------

describe("Skill Lifecycle: Activation", () => {
  // L-1: Activate a draft skill
  it("admin activates a draft skill making it available for agent assignment", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft skill
    const user = await createTestUser(baseUrl, `lc-l1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `lc-l1-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "compliance-check",
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string; status: string } };
    expect(skill.status).toBe("draft");

    // When the admin activates the skill
    const activateRes = await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the status changes to active
    expect(activateRes.status).toBe(200);
    const dbRecord = await getSkillFromDb(surreal, skill.id);
    expect(dbRecord?.status).toBe("active");
  }, 120_000);
});

describe("Skill Lifecycle: Deprecation", () => {
  // L-2: Deprecate an active skill
  it("admin deprecates an active skill removing it from assignment", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active skill
    const user = await createTestUser(baseUrl, `lc-l2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `lc-l2-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "old-audit",
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // When the admin deprecates the skill
    const deprecateRes = await deprecateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the status changes to deprecated
    expect(deprecateRes.status).toBe(200);
    const dbRecord = await getSkillFromDb(surreal, skill.id);
    expect(dbRecord?.status).toBe("deprecated");
  }, 120_000);

  // L-5: Deprecated skill is excluded from active skill listing
  it("deprecated skill does not appear in active skill listing", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with 1 active and 1 deprecated skill
    const user = await createTestUser(baseUrl, `lc-l5-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `lc-l5-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    // Create and activate both
    const skill1Res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "still-active" }));
    const skill1 = (await skill1Res.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill1.skill.id);

    const skill2Res = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({ name: "now-deprecated" }));
    const skill2 = (await skill2Res.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill2.skill.id);

    // Deprecate the second
    await deprecateSkillViaHttp(baseUrl, user, workspaceId, skill2.skill.id);

    // When the admin lists active skills
    const res = await listSkillsViaHttp(baseUrl, user, workspaceId, "active");

    // Then only the active skill is returned
    const body = (await res.json()) as { skills: SkillListItem[] };
    expect(body.skills.length).toBe(1);
    expect(body.skills[0].name).toBe("still-active");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------

describe("Skill Lifecycle: Invalid Transitions", () => {
  // L-3: Activating a non-draft skill is rejected
  it("activating an already active skill is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active skill
    const user = await createTestUser(baseUrl, `lc-l3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `lc-l3-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "already-active",
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };
    await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // When the admin tries to activate an already active skill
    const res = await activateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the transition is rejected
    expect(res.status).toBe(409);
  }, 120_000);

  // L-4: Deprecating a non-active skill is rejected
  it("deprecating a draft skill is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a draft skill (not yet activated)
    const user = await createTestUser(baseUrl, `lc-l4-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `lc-l4-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const createRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "still-draft",
    }));
    const { skill } = (await createRes.json()) as { skill: { id: string } };

    // When the admin tries to deprecate a draft skill
    const res = await deprecateSkillViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the transition is rejected
    expect(res.status).toBe(409);
  }, 120_000);
});
