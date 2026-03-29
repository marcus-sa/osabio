/**
 * Operational Dashboard: R3 Focused Scenarios
 *
 * Traces: US-09 (edit), US-10 (resume sessions), US-11 (connection status),
 *         US-12 (delete with sessions), US-13 (empty states)
 *
 * All scenarios are skipped pending R3 implementation.
 * R1 (walking skeleton + external CRUD) and R2 (sandbox) must pass first.
 *
 * Driving ports:
 *   PUT    /api/workspaces/:workspaceId/agents/:agentId (update agent)
 *   DELETE /api/workspaces/:workspaceId/agents/:agentId (delete with sessions)
 *   GET    /api/workspaces/:workspaceId/agents/:agentId (detail with status)
 *   GET    /api/workspaces/:workspaceId/agents          (list with empty states)
 */
import { describe, expect, it } from "bun:test";
import {
  setupAgentSuite,
  createAgentTestWorkspace,
  createAgentViaHttp,
  getAgentDetailViaHttp,
  updateAgentViaHttp,
  deleteAgentViaHttp,
  listAgentsViaHttp,
  getAuthorityEdgesForIdentity,
  type CreateAgentResponse,
  type AgentDetailResponse,
  type DeleteAgentResponse,
} from "./agents-test-kit";
import { createAgentSessionDirectly } from "../shared-fixtures";

const getRuntime = setupAgentSuite("agent_operational_dashboard");

// =============================================================================
// US-09: Edit Agent Configuration and Authority Scopes
// =============================================================================

describe.skip("Edit Agent Configuration", () => {
  it("admin updates agent description and authority scopes", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "edit-config");

    // Given an external agent exists with initial configuration
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Config Target",
      description: "Original description",
      runtime: "external",
      authority_scopes: [
        { action: "create_observation", permission: "propose" },
      ],
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // When the admin updates the agent description and authority scopes
    const updateResponse = await updateAgentViaHttp(baseUrl, user, workspaceId, agent.id, {
      description: "Updated description for supply chain monitoring",
      authority_scopes: [
        { action: "create_observation", permission: "auto" },
        { action: "create_decision", permission: "propose" },
      ],
    });

    // Then the update succeeds
    expect(updateResponse.status).toBe(200);

    // And the detail page reflects the updated values
    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agent.id);
    const detail = (await detailResponse.json()) as AgentDetailResponse;
    expect(detail.agent.description).toBe("Updated description for supply chain monitoring");

    // And the authority scopes are updated
    const obsScope = detail.authority_scopes.find((s) => s.action === "create_observation");
    expect(obsScope?.permission).toBe("auto");
  }, 120_000);

  it("admin renames an agent and the identity name is synced", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "rename");

    // Given an external agent exists
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Old Name",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // When the admin renames the agent
    const updateResponse = await updateAgentViaHttp(baseUrl, user, workspaceId, agent.id, {
      name: "New Name",
    });

    // Then the rename succeeds
    expect(updateResponse.status).toBe(200);

    // And the detail page shows the new name on both agent and identity
    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agent.id);
    const detail = (await detailResponse.json()) as AgentDetailResponse;
    expect(detail.agent.name).toBe("New Name");
    expect(detail.identity.name).toBe("New Name");
  }, 120_000);

  it("editing a brain agent is rejected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "edit-brain");

    // Given a brain agent exists
    const { seedBrainAgent } = await import("./agents-test-kit");
    const { agentId } = await seedBrainAgent(surreal, workspaceId, "Chat Agent", {
      agentType: "chat_agent",
    });

    // When the admin attempts to edit the brain agent
    const response = await updateAgentViaHttp(baseUrl, user, workspaceId, agentId, {
      description: "Should not be editable",
    });

    // Then the edit is rejected
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120_000);
});

// =============================================================================
// US-12: Delete Agent with Active Session Warning
// =============================================================================

describe.skip("Delete Agent with Active Sessions", () => {
  it("deleting an agent with active sessions aborts them first", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "del-sessions");

    // Given an external agent with active sessions
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Busy Agent",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // And the agent has active sessions
    await createAgentSessionDirectly(surreal, workspaceId, {
      agent: "Busy Agent",
      status: "active",
    });
    await createAgentSessionDirectly(surreal, workspaceId, {
      agent: "Busy Agent",
      status: "idle",
    });

    // When the admin deletes the agent
    const deleteResponse = await deleteAgentViaHttp(
      baseUrl, user, workspaceId, agent.id, "Busy Agent",
    );

    // Then the deletion succeeds
    expect(deleteResponse.status).toBe(200);
    const deleteBody = (await deleteResponse.json()) as DeleteAgentResponse;

    // And the active sessions were aborted
    expect(deleteBody.sessions_aborted).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("historical session records are preserved after agent deletion", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "preserve-hist");

    // Given an external agent with completed sessions
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "History Agent",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    const { sessionId } = await createAgentSessionDirectly(surreal, workspaceId, {
      agent: "History Agent",
      status: "completed",
    });

    // When the admin deletes the agent
    await deleteAgentViaHttp(baseUrl, user, workspaceId, agent.id, "History Agent");

    // Then the historical session record still exists
    const rows = (await surreal.query(
      `SELECT id FROM agent_session WHERE id = $sess;`,
      { sess: new (await import("surrealdb")).RecordId("agent_session", sessionId) },
    )) as Array<Array<{ id: unknown }>>;
    expect(rows[0]?.length).toBe(1);
  }, 120_000);
});

// =============================================================================
// US-11: View External Agent Connection Status
// =============================================================================

describe.skip("External Agent Connection Status", () => {
  it("newly created external agent shows 'never connected' status", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "conn-new");

    // Given a newly created external agent
    const createResponse = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Fresh Agent",
      runtime: "external",
    });
    expect(createResponse.status).toBe(201);
    const { agent } = (await createResponse.json()) as CreateAgentResponse;

    // When the admin views the agent detail
    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agent.id);
    const detail = (await detailResponse.json()) as AgentDetailResponse;

    // Then the connection status indicates never connected
    expect(detail.agent.runtime).toBe("external");
    // Connection status will be part of the detail response in R3
  }, 120_000);
});

// =============================================================================
// US-10: Resume or Send Feedback to Idle Sessions (placeholder)
// =============================================================================

describe.skip("Resume Idle Sessions", () => {
  it("resuming an idle session changes its status to active", async () => {
    // Placeholder: session resume will be tested with orchestrator integration
    expect(true).toBe(true);
  }, 120_000);

  it("sending feedback to an idle session delivers the message", async () => {
    // Placeholder: feedback delivery
    expect(true).toBe(true);
  }, 120_000);
});

// =============================================================================
// US-13: Empty States for Agent Sections
// =============================================================================

describe.skip("Empty States", () => {
  it("workspace with no custom agents shows guidance for each runtime section", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "empty-state");

    // When the admin views the agents page for a fresh workspace
    const response = await listAgentsViaHttp(baseUrl, user, workspaceId);
    expect(response.status).toBe(200);

    // Then the response indicates no custom agents exist
    const body = (await response.json()) as { agents: Array<{ runtime: string }> };
    const customAgents = body.agents.filter((a) => a.runtime !== "brain");
    expect(customAgents.length).toBe(0);
  }, 120_000);
});
