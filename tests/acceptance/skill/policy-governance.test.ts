/**
 * Policy Governance: governs_skill relation and governance visibility
 *
 * Traces: US-10 (policy governance for skills)
 *
 * Validates that policies can be linked to skills via governs_skill
 * relations, and that skill detail pages correctly display governance
 * information.
 *
 * Driving ports:
 *   GET  /api/workspaces/:wsId/skills/:skillId         (skill detail with governance)
 *   POST /api/workspaces/:wsId/skills                  (create skill)
 *   SurrealDB direct queries                           (governs_skill relation setup)
 */
import { describe, expect, it } from "bun:test";
import {
  setupSkillSuite,
  createTestUser,
  createTestWorkspace,
  linkUserToWorkspaceIdentity,
  createSkillViaHttp,
  getSkillDetailViaHttp,
  seedPolicy,
  linkPolicyToSkill,
  makeSkillInput,
  type SkillDetailResponse,
} from "./skill-test-kit";

const getRuntime = setupSkillSuite("policy_governance");

// ---------------------------------------------------------------------------
// Happy Paths
// ---------------------------------------------------------------------------

describe("Policy Governance: governs_skill relation", () => {
  // G-1: governs_skill relation links policy to skill
  it("policy linked to skill via governs_skill relation is persisted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a skill and a policy
    const user = await createTestUser(baseUrl, `gov-g1-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `gov-g1-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
    }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };

    const policy = await seedPolicy(surreal, workspaceId, "Security Tool Access");

    // When the governs_skill relation is created
    await linkPolicyToSkill(surreal, policy.id, skill.id);

    // Then the relation exists in the graph
    const [rows] = await surreal.query<[Array<{ count: number }>]>(
      `SELECT count() AS count FROM governs_skill WHERE in = $policy AND out = $skill GROUP ALL;`,
      {
        policy: policy.record,
        skill: new (await import("surrealdb")).RecordId("skill", skill.id),
      },
    );
    expect(rows[0]?.count ?? 0).toBe(1);
  }, 120_000);

  // G-2: Skill detail shows governing policy
  it("skill detail page includes governing policy information", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a skill governed by a policy
    const user = await createTestUser(baseUrl, `gov-g2-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `gov-g2-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "security-audit",
      description: "Audits for security compliance",
    }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };

    const policy = await seedPolicy(surreal, workspaceId, "Security Tool Access");
    await linkPolicyToSkill(surreal, policy.id, skill.id);

    // When the admin views the skill detail
    const detailRes = await getSkillDetailViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the governed_by section includes the linked policy
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as SkillDetailResponse;
    expect(detail.governed_by).toBeDefined();
    expect(detail.governed_by.length).toBe(1);
    expect(detail.governed_by[0].name).toBe("Security Tool Access");
    expect(detail.governed_by[0].status).toBe("active");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("Policy Governance: Edge Cases", () => {
  // G-3: Skill with no governing policy shows empty governance
  it("skill without governing policy shows empty governed_by section", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a skill with no governing policy
    const user = await createTestUser(baseUrl, `gov-g3-${crypto.randomUUID()}`);
    const workspace = await createTestWorkspace(surreal, `gov-g3-${crypto.randomUUID()}`);
    const { workspaceId } = workspace;
    await linkUserToWorkspaceIdentity(baseUrl, surreal, user, workspace);

    const skillRes = await createSkillViaHttp(baseUrl, user, workspaceId, makeSkillInput({
      name: "ungoverned-skill",
    }));
    const { skill } = (await skillRes.json()) as { skill: { id: string } };

    // When the admin views the skill detail
    const detailRes = await getSkillDetailViaHttp(baseUrl, user, workspaceId, skill.id);

    // Then the governed_by section is empty
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as SkillDetailResponse;
    expect(detail.governed_by).toBeDefined();
    expect(detail.governed_by.length).toBe(0);
  }, 120_000);
});
