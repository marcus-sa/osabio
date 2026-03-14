/**
 * Milestone 2: Policy Creation + Validation
 *
 * Traces: US-PCUI-02 (Create Policy)
 *
 * Validates that human identities can create draft policies with valid
 * rules, and that creation is rejected for missing title, missing rules,
 * and invalid predicate structure.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/policies
 *   GET  /api/workspaces/:wsId/policies/:id
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createPolicyViaApi,
  getPolicyDetail,
  buildPolicyBody,
  buildMinimalRule,
  type PolicyDetailResponse,
} from "./policy-crud-test-kit";

const getRuntime = setupAcceptanceSuite("policy_crud_m2_creation");

// =============================================================================
// US-PCUI-02: Create Policy
// =============================================================================

describe("Milestone 2: Policy Creation (US-PCUI-02)", () => {

  // ---------------------------------------------------------------------------
  // Walking Skeleton: Admin creates a draft policy with valid rules
  // AC: POST returns 201 with policy_id, policy has draft status and version 1
  // ---------------------------------------------------------------------------
  it("admin creates a draft policy with one deny rule", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-create-happy");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin creates a policy with a deploy-blocking rule
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Block Production Deployments",
        description: "Prevents agents from deploying to production without human approval",
        rules: [
          buildMinimalRule({
            id: "block_prod_deploy",
            condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
            effect: "deny",
            priority: 100,
          }),
        ],
        human_veto_required: true,
      }),
    );

    // Then the policy is created as a draft
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string };
    expect(body.policy_id).toBeDefined();

    // And the policy detail shows draft status with version 1
    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.status).toBe("draft");
    expect(detail.policy.version).toBe(1);
    expect(detail.policy.title).toBe("Block Production Deployments");
    expect(detail.policy.human_veto_required).toBe(true);
    expect(detail.policy.rules).toHaveLength(1);
    expect(detail.policy.rules[0].id).toBe("block_prod_deploy");
    expect(detail.policy.rules[0].effect).toBe("deny");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Admin creates policy with multiple rules
  // AC: Policy with multiple rules is created and all rules persisted
  // ---------------------------------------------------------------------------
  it("admin creates a policy with multiple rules at different priorities", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-multi-rules");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin creates a policy with two rules
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Tiered Access Control",
        rules: [
          buildMinimalRule({
            id: "block_deploy",
            condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
            effect: "deny",
            priority: 100,
          }),
          buildMinimalRule({
            id: "allow_read",
            condition: { field: "action_spec.action", operator: "eq", value: "read" },
            effect: "allow",
            priority: 10,
          }),
        ],
      }),
    );

    // Then the policy is created with both rules
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string };

    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.rules).toHaveLength(2);

    const ruleIds = detail.policy.rules.map(r => r.id);
    expect(ruleIds).toContain("block_deploy");
    expect(ruleIds).toContain("allow_read");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Policy with selector is created correctly
  // AC: Selector fields are persisted
  // ---------------------------------------------------------------------------
  it("admin creates a policy with agent role selector", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-selector");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin creates a policy with a selector
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      buildPolicyBody({
        title: "Coding Agent Budget Cap",
        selector: { agent_role: "coding" },
        rules: [
          buildMinimalRule({
            id: "budget_cap",
            condition: { field: "budget_limit.amount", operator: "gt", value: 1000 },
            effect: "deny",
            priority: 50,
          }),
        ],
      }),
    );

    // Then the selector is preserved on the created policy
    expect(response.status).toBe(201);
    const body = await response.json() as { policy_id: string };

    const detailResponse = await getPolicyDetail(
      baseUrl, user.headers, workspace.workspaceId, body.policy_id,
    );
    const detail = await detailResponse.json() as PolicyDetailResponse;
    expect(detail.policy.selector.agent_role).toBe("coding");
  }, 120_000);
});

// =============================================================================
// US-PCUI-02: Validation Errors
// =============================================================================

describe("Milestone 2: Policy Creation Validation (US-PCUI-02)", () => {

  // ---------------------------------------------------------------------------
  // Missing title is rejected
  // AC: POST without title returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected without a title", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-no-title");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy without a title
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "",
        rules: [buildMinimalRule()],
      },
    );

    // Then the request is rejected with validation error
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("title");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Missing rules is rejected
  // AC: POST without rules returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected without any rules", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-no-rules");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy with empty rules
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "No Rules Policy",
        rules: [],
      },
    );

    // Then the request is rejected with validation error
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("rule");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Invalid predicate structure is rejected
  // AC: POST with malformed rule condition returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected with invalid predicate structure", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-bad-predicate");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy with an invalid condition
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "Bad Predicate Policy",
        rules: [{
          id: "bad_rule",
          condition: { invalid: "structure" } as unknown,
          effect: "deny",
          priority: 100,
        }],
      },
    );

    // Then the request is rejected with validation error
    expect(response.status).toBe(400);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Invalid effect value is rejected
  // AC: POST with effect other than allow/deny returns 400
  // ---------------------------------------------------------------------------
  it("policy creation is rejected with invalid rule effect", async () => {
    const { baseUrl } = getRuntime();

    // Given an admin in a workspace
    const user = await createTestUser(baseUrl, "m2-bad-effect");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When admin attempts to create a policy with an invalid effect
    const response = await createPolicyViaApi(
      baseUrl,
      user.headers,
      workspace.workspaceId,
      {
        title: "Bad Effect Policy",
        rules: [{
          id: "bad_rule",
          condition: { field: "action_spec.action", operator: "eq", value: "deploy" },
          effect: "maybe" as "allow",
          priority: 100,
        }],
      },
    );

    // Then the request is rejected
    expect(response.status).toBe(400);
  }, 120_000);
});
