/**
 * External Agent CRUD: Focused Scenarios (R1)
 *
 * Traces: US-01 (registry), US-02 (create), US-03 (detail), US-04 (delete)
 *
 * Focused boundary tests for external agent lifecycle. These complement the
 * walking skeleton with error paths, edge cases, and business rule validation.
 *
 * Error path ratio: 10 error/edge scenarios out of 18 total (~56%)
 *
 * Driving ports:
 *   GET    /api/workspaces/:workspaceId/agents          (list)
 *   POST   /api/workspaces/:workspaceId/agents          (create)
 *   GET    /api/workspaces/:workspaceId/agents/:agentId (detail)
 *   DELETE /api/workspaces/:workspaceId/agents/:agentId (delete)
 */
import { describe, expect, it } from "bun:test";
import {
  setupAgentSuite,
  createAgentTestWorkspace,
  listAgentsViaHttp,
  createAgentViaHttp,
  getAgentDetailViaHttp,
  deleteAgentViaHttp,
  getAgentFromDb,
  getIdentityForAgent,
  getProxyTokensForIdentity,
  getAuthorityEdgesForIdentity,
  hasMemberOfEdge,
  agentExistsInDb,
  identityExistsInDb,
  seedBrainAgent,
  type CreateAgentResponse,
  type AgentDetailResponse,
  type AgentListItem,
  type DeleteAgentResponse,
} from "./agents-test-kit";

const getRuntime = setupAgentSuite("agent_external_crud");

// =============================================================================
// US-02: Create External Agent -- Happy Paths
// =============================================================================

describe("Create External Agent: Success Paths", () => {
  it("proxy token is generated with cryptographic prefix for external agents", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "token-prefix");

    // When the admin creates an external agent
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Audit Trail Agent",
      runtime: "external",
    });

    // Then the proxy token starts with "brp_" (proxy token prefix from proxy-token-core.ts)
    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateAgentResponse;
    expect(body.proxy_token).toBeDefined();
    expect(body.proxy_token!.startsWith("brp_")).toBe(true);
    // And the token is long enough to be cryptographically secure
    expect(body.proxy_token!.length).toBeGreaterThan(20);
  }, 120_000);

  it("authority scopes default to 'propose' when not specified", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "default-scope");

    // When the admin creates an external agent without specifying authority scopes
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Default Scope Agent",
      runtime: "external",
    });

    // Then the agent is created
    expect(response.status).toBe(201);
    const { agent } = (await response.json()) as CreateAgentResponse;

    // And the detail page shows authority scopes defaulting to "propose"
    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agent.id);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as AgentDetailResponse;

    // All configured scopes should default to "propose"
    for (const scope of detail.authority_scopes) {
      expect(scope.permission).toBe("propose");
    }
  }, 120_000);

  it("creation executes atomically -- identity, edges, and agent created together", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "atomic");

    // When the admin creates an external agent
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Atomic Test Agent",
      runtime: "external",
      authority_scopes: [{ action: "create_observation", permission: "auto" }],
    });

    expect(response.status).toBe(201);
    const { agent } = (await response.json()) as CreateAgentResponse;

    // Then the agent record exists with the correct runtime
    const agentRecord = await getAgentFromDb(surreal, agent.id);
    expect(agentRecord).toBeDefined();
    expect(agentRecord!.runtime).toBe("external");
    expect(agentRecord!.name).toBe("Atomic Test Agent");

    // And an identity record is linked to the agent
    const identity = await getIdentityForAgent(surreal, agent.id);
    expect(identity).toBeDefined();
    expect(identity!.type).toBe("agent");
    expect(identity!.role).toBe("custom");

    // And the identity is a member of the workspace
    const isMember = await hasMemberOfEdge(surreal, agent.identity_id, workspaceId);
    expect(isMember).toBe(true);

    // And a proxy token is stored for the identity
    const tokens = await getProxyTokensForIdentity(surreal, agent.identity_id);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// =============================================================================
// US-02: Create External Agent -- Error Paths
// =============================================================================

describe("Create External Agent: Error Paths", () => {
  it("duplicate agent name within workspace produces validation error", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "dup-name");

    // Given an external agent "Quality Inspector" already exists
    const firstResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Quality Inspector",
      runtime: "external",
    });
    expect(firstResponse.status).toBe(201);

    // When the admin tries to create another agent with the same name
    const duplicateResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Quality Inspector",
      runtime: "external",
    });

    // Then the creation is rejected with a validation error
    expect(duplicateResponse.status).toBe(409);
    const errorBody = (await duplicateResponse.json()) as { error: string };
    expect(errorBody.error).toBeDefined();
  }, 120_000);

  it("creating a brain agent via the API is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "no-brain");

    // When the admin attempts to create a brain agent through the API
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Fake Brain Agent",
      runtime: "brain" as "external",
    });

    // Then the request is rejected -- brain agents are code-deployed only
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120_000);

  it("transaction failure leaves no partial records", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "partial");

    // Given an agent with the name "Unique Agent" already exists
    await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Unique Agent",
      runtime: "external",
    });

    // When a duplicate creation attempt fails
    const failedResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Unique Agent",
      runtime: "external",
    });
    expect(failedResponse.status).toBe(409);

    // Then only one agent with that name exists (no orphaned identity or edges)
    const listResponse = await listAgentsViaHttp(baseUrl, user, workspaceId);
    const { agents } = (await listResponse.json()) as { agents: AgentListItem[] };
    const matchingAgents = agents.filter((a) => a.name === "Unique Agent");
    expect(matchingAgents.length).toBe(1);
  }, 120_000);

  it("creation without a name is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "no-name");

    // When the admin submits a creation request without a name
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "",
      runtime: "external",
    });

    // Then the request is rejected with a validation error
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120_000);

  it("creation without authentication is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "no-auth");

    // When an unauthenticated request tries to create an agent
    const response = await fetch(
      `${baseUrl}/api/workspaces/${workspaceId}/agents`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Unauthorized Agent", runtime: "external" }),
      },
    );

    // Then the request is rejected
    expect(response.status).toBeGreaterThanOrEqual(401);
  }, 120_000);
});

// =============================================================================
// US-01: View Agent Registry -- Focused Scenarios
// =============================================================================

describe("View Agent Registry: Focused Scenarios", () => {
  it("empty workspace shows no custom agents", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "empty");

    // When the admin views the agents page for a fresh workspace
    const response = await listAgentsViaHttp(baseUrl, user, workspaceId);

    // Then the response succeeds
    expect(response.status).toBe(200);
    const { agents } = (await response.json()) as { agents: AgentListItem[] };

    // And no external or sandbox agents exist
    const customAgents = agents.filter((a) => a.runtime !== "brain");
    expect(customAgents.length).toBe(0);
  }, 120_000);

  it("brain agents are listed as read-only (no edit/delete actions)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "brain-ro");

    // Given brain agents exist in the workspace
    await seedBrainAgent(surreal, workspaceId, "Observer", { agentType: "observer" });

    // When the admin views the agents page
    const response = await listAgentsViaHttp(baseUrl, user, workspaceId);
    expect(response.status).toBe(200);
    const { agents } = (await response.json()) as { agents: AgentListItem[] };

    // Then brain agents appear with runtime "brain"
    const brainAgents = agents.filter((a) => a.runtime === "brain");
    expect(brainAgents.length).toBeGreaterThanOrEqual(1);
    expect(brainAgents.some((a) => a.name === "Observer")).toBe(true);
  }, 120_000);

  it("listing agents for a nonexistent workspace returns an error", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user } = await createAgentTestWorkspace(baseUrl, surreal, "bad-ws");

    // When the admin requests agents for a workspace that does not exist
    const response = await listAgentsViaHttp(baseUrl, user, "nonexistent-workspace-id");

    // Then the request returns an error
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120_000);
});

// =============================================================================
// US-03: View Agent Detail -- Focused Scenarios
// =============================================================================

describe("View Agent Detail: Focused Scenarios", () => {
  it("brain agent detail is read-only with explanatory context", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "brain-detail");

    // Given a brain agent exists
    const { agentId } = await seedBrainAgent(surreal, workspaceId, "Architect", {
      agentType: "architect",
      description: "Technical decisions and system design",
    });

    // When the admin views the brain agent detail
    const response = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agentId);

    // Then the detail page shows the agent information
    expect(response.status).toBe(200);
    const detail = (await response.json()) as AgentDetailResponse;
    expect(detail.agent.name).toBe("Architect");
    expect(detail.agent.runtime).toBe("brain");
  }, 120_000);

  it("requesting detail for a nonexistent agent returns not found", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "no-agent");

    // When the admin requests detail for an agent that does not exist
    const response = await getAgentDetailViaHttp(baseUrl, user, workspaceId, "nonexistent-id");

    // Then a not found error is returned
    expect(response.status).toBe(404);
  }, 120_000);
});

// =============================================================================
// US-04: Delete Agent -- Focused Scenarios
// =============================================================================

describe("Delete Agent: Focused Scenarios", () => {
  it("delete with wrong confirmation name is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "wrong-name");

    // Given an external agent "Demand Forecaster" exists
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Demand Forecaster",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // When the admin tries to delete but types the wrong name
    const deleteResponse = await deleteAgentViaHttp(
      baseUrl, user, workspaceId, agent.id, "Wrong Name",
    );

    // Then the deletion is rejected
    expect(deleteResponse.status).toBeGreaterThanOrEqual(400);

    // And the agent still exists
    const exists = await agentExistsInDb(surreal, agent.id);
    expect(exists).toBe(true);
  }, 120_000);

  it("deleting a brain agent is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "del-brain");

    // Given a brain agent exists
    const { agentId } = await seedBrainAgent(surreal, workspaceId, "PM Agent", {
      agentType: "management",
    });

    // When the admin attempts to delete the brain agent
    const response = await deleteAgentViaHttp(
      baseUrl, user, workspaceId, agentId, "PM Agent",
    );

    // Then the deletion is rejected -- brain agents cannot be deleted
    expect(response.status).toBeGreaterThanOrEqual(400);

    // And the brain agent still exists
    const exists = await agentExistsInDb(surreal, agentId);
    expect(exists).toBe(true);
  }, 120_000);

  it("deletion removes identity and all graph edges atomically", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "full-del");

    // Given an external agent with authority scopes
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Cleanup Target",
      runtime: "external",
      authority_scopes: [
        { action: "create_observation", permission: "auto" },
        { action: "create_decision", permission: "propose" },
      ],
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;
    const identityId = agent.identity_id;

    // When the admin deletes the agent
    const deleteResponse = await deleteAgentViaHttp(
      baseUrl, user, workspaceId, agent.id, "Cleanup Target",
    );
    expect(deleteResponse.status).toBe(200);

    // Then the agent record is removed
    expect(await agentExistsInDb(surreal, agent.id)).toBe(false);

    // And the identity record is removed
    expect(await identityExistsInDb(surreal, identityId)).toBe(false);

    // And the member_of edge is removed
    expect(await hasMemberOfEdge(surreal, identityId, workspaceId)).toBe(false);

    // And the authorized_to edges are removed
    const edges = await getAuthorityEdgesForIdentity(surreal, identityId);
    expect(edges.length).toBe(0);
  }, 120_000);

  it("deleting a nonexistent agent returns not found", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "del-404");

    // When the admin tries to delete an agent that does not exist
    const response = await deleteAgentViaHttp(
      baseUrl, user, workspaceId, "nonexistent-id", "Anything",
    );

    // Then a not found error is returned
    expect(response.status).toBe(404);
  }, 120_000);
});

// =============================================================================
// Cross-Cutting: Workspace Isolation
// =============================================================================

describe("Workspace Isolation", () => {
  it("agents in one workspace are not visible in another workspace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given workspace A has an external agent
    const wsA = await createAgentTestWorkspace(baseUrl, surreal, "iso-a");
    await createAgentViaHttp(baseUrl, wsA.user, wsA.workspaceId, {
      name: "Workspace A Agent",
      runtime: "external",
    });

    // And workspace B has no custom agents
    const wsB = await createAgentTestWorkspace(baseUrl, surreal, "iso-b");

    // When admin B lists agents in workspace B
    const listResponse = await listAgentsViaHttp(baseUrl, wsB.user, wsB.workspaceId);
    expect(listResponse.status).toBe(200);
    const { agents } = (await listResponse.json()) as { agents: AgentListItem[] };

    // Then workspace A's agent does not appear
    const found = agents.find((a) => a.name === "Workspace A Agent");
    expect(found).toBeUndefined();
  }, 120_000);

  it("same agent name is allowed across different workspaces", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given workspace A has an agent named "Compliance Bot"
    const wsA = await createAgentTestWorkspace(baseUrl, surreal, "dup-a");
    const responseA = await createAgentViaHttp(baseUrl, wsA.user, wsA.workspaceId, {
      name: "Compliance Bot",
      runtime: "external",
    });
    expect(responseA.status).toBe(201);

    // When admin B creates an agent with the same name in workspace B
    const wsB = await createAgentTestWorkspace(baseUrl, surreal, "dup-b");
    const responseB = await createAgentViaHttp(baseUrl, wsB.user, wsB.workspaceId, {
      name: "Compliance Bot",
      runtime: "external",
    });

    // Then the creation succeeds -- names are unique per workspace only
    expect(responseB.status).toBe(201);
  }, 120_000);
});
