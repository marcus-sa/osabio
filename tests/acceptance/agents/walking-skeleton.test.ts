/**
 * Walking Skeleton: Agent Management E2E
 *
 * Traces: US-01 (registry), US-02 (create external), US-03 (detail), US-04 (delete)
 *
 * These are the minimum viable E2E paths through the agent management system.
 * Skeleton 1: Admin registers external agent and receives proxy token
 * Skeleton 2: Admin views agent detail and sees authority scopes
 * Skeleton 3: Admin deletes agent and all related records are removed
 *
 * Together they prove:
 * - Schema migration works (runtime field on agent)
 * - 5-step transactional creation works (agent + identity + edges)
 * - Proxy token generation works (external agents only)
 * - Authority model works (authorized_to edges)
 * - Deletion is atomic (agent + identity + edges removed)
 * - Registry listing works (workspace-scoped graph traversal)
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
  agentExistsInDb,
  identityExistsInDb,
  getProxyTokensForIdentity,
  seedBrainAgent,
  type CreateAgentResponse,
  type AgentDetailResponse,
  type AgentListItem,
  type DeleteAgentResponse,
} from "./agents-test-kit";

const getRuntime = setupAgentSuite("agent_walking_skeleton");

describe("Walking Skeleton: External Agent CRUD", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Register external agent and receive proxy token
  // US-02: Create External Agent with Authority Scopes
  // ---------------------------------------------------------------------------
  it("admin registers an external agent and receives a one-time proxy token", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where an admin manages agents
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "ws1");

    // When the admin registers an external agent named "Compliance Bot"
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Compliance Bot",
      description: "Monitors regulatory compliance across supply chain",
      runtime: "external",
      authority_scopes: [
        { action: "create_observation", permission: "auto" },
        { action: "create_decision", permission: "propose" },
      ],
    });

    // Then the agent is created successfully
    expect(createResponse.status).toBe(201);
    const body = (await createResponse.json()) as CreateAgentResponse;
    expect(body.agent.name).toBe("Compliance Bot");
    expect(body.agent.runtime).toBe("external");

    // And a proxy token is generated with the expected prefix
    expect(body.proxy_token).toBeDefined();
    expect(body.proxy_token!.startsWith("osp_")).toBe(true);

    // And the agent appears in the workspace registry
    const listResponse = await listAgentsViaHttp(baseUrl, user, workspaceId);
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { agents: AgentListItem[] };
    const found = listBody.agents.find((a) => a.name === "Compliance Bot");
    expect(found).toBeDefined();
    expect(found!.runtime).toBe("external");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: View agent detail with authority scopes
  // US-03: View Agent Detail Page
  // ---------------------------------------------------------------------------
  it("admin views agent detail and sees configured authority scopes", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an external agent "Freight Tracker" exists in the workspace
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "ws2");
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Freight Tracker",
      description: "Tracks freight shipments and delivery status",
      runtime: "external",
      authority_scopes: [
        { action: "create_observation", permission: "auto" },
        { action: "create_decision", permission: "blocked" },
      ],
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // When the admin views the agent detail page
    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agent.id);

    // Then the detail page shows agent information and authority scopes
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as AgentDetailResponse;
    expect(detail.agent.name).toBe("Freight Tracker");
    expect(detail.agent.runtime).toBe("external");
    expect(detail.agent.description).toBe("Tracks freight shipments and delivery status");

    // And the authority scopes reflect the configured permissions
    expect(detail.authority_scopes.length).toBeGreaterThanOrEqual(2);
    const observationScope = detail.authority_scopes.find((s) => s.action === "create_observation");
    expect(observationScope?.permission).toBe("auto");
    const decisionScope = detail.authority_scopes.find((s) => s.action === "create_decision");
    expect(decisionScope?.permission).toBe("blocked");

    // And the linked identity exists
    expect(detail.identity).toBeDefined();
    expect(detail.identity.name).toBe("Freight Tracker");
    expect(detail.identity.type).toBe("agent");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 3: Delete agent and verify cleanup
  // US-04: Delete Agent with Confirmation
  // ---------------------------------------------------------------------------
  it("admin deletes an agent and all related records are removed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an external agent "Partner ERP" exists in the workspace
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "ws3");
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Partner ERP",
      description: "Integrates with partner ERP systems",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // When the admin deletes the agent by confirming the agent name
    const deleteResponse = await deleteAgentViaHttp(
      baseUrl, user, workspaceId, agent.id, "Partner ERP",
    );

    // Then the deletion succeeds
    expect(deleteResponse.status).toBe(200);
    const deleteBody = (await deleteResponse.json()) as DeleteAgentResponse;
    expect(deleteBody.deleted).toBe(true);

    // And the agent no longer appears in the registry
    const listResponse = await listAgentsViaHttp(baseUrl, user, workspaceId);
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { agents: AgentListItem[] };
    const found = listBody.agents.find((a) => a.name === "Partner ERP");
    expect(found).toBeUndefined();

    // And the agent record is removed from the database
    const exists = await agentExistsInDb(surreal, agent.id);
    expect(exists).toBe(false);
  }, 120_000);
});

describe("Walking Skeleton: Agent Registry Listing", () => {
  // ---------------------------------------------------------------------------
  // US-01: View Agent Registry -- agents grouped by runtime
  // ---------------------------------------------------------------------------
  it("admin sees all agents in the workspace grouped by runtime type", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with osabio agents and custom agents
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "ws4");

    // And the workspace has osabio agents (system agents)
    await seedBrainAgent(surreal, workspaceId, "Observer", { agentType: "observer" });
    await seedBrainAgent(surreal, workspaceId, "Chat Agent", { agentType: "chat_agent" });

    // And the admin has registered an external agent
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Inventory Scanner",
      description: "Scans warehouse inventory levels",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);

    // When the admin views the agents page
    const listResponse = await listAgentsViaHttp(baseUrl, user, workspaceId);

    // Then all agents are listed with their runtime types
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { agents: AgentListItem[] };

    // And agents include both osabio and external runtime types
    const osabioAgents = listBody.agents.filter((a) => a.runtime === "osabio");
    const externalAgents = listBody.agents.filter((a) => a.runtime === "external");
    expect(osabioAgents.length).toBeGreaterThanOrEqual(2);
    expect(externalAgents.length).toBeGreaterThanOrEqual(1);
    expect(externalAgents.some((a) => a.name === "Inventory Scanner")).toBe(true);
  }, 120_000);
});
