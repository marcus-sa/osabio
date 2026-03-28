/**
 * Sandbox Agent Creation: R2 Focused Scenarios
 *
 * Traces: US-05 (create sandbox), US-06 (filter), US-07 (spawn), US-08 (sessions)
 *
 * All scenarios are skipped pending R2 implementation.
 * The walking skeleton tests (R1) must pass first.
 *
 * Driving ports:
 *   POST   /api/workspaces/:workspaceId/agents          (create sandbox agent)
 *   GET    /api/workspaces/:workspaceId/agents           (list with filter)
 *   GET    /api/workspaces/:workspaceId/agents/:agentId (detail with sessions)
 */
import { describe, expect, it } from "bun:test";
import {
  setupAgentSuite,
  createAgentTestWorkspace,
  createAgentViaHttp,
  listAgentsViaHttp,
  getAgentDetailViaHttp,
  type CreateAgentResponse,
  type AgentDetailResponse,
  type AgentListItem,
} from "./agents-test-kit";
import { RecordId } from "surrealdb";

const getRuntime = setupAgentSuite("agent_sandbox_creation");

// =============================================================================
// US-05: Create Sandbox Agent with Configuration
// =============================================================================

describe.skip("Create Sandbox Agent", () => {
  it("admin creates a sandbox agent with coding agents and environment variables", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "sbx-create");

    // Given the workspace has a sandbox provider configured
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `UPDATE $ws SET settings.sandbox_provider = "local";`,
      { ws: wsRecord },
    );

    // When the admin creates a sandbox agent with runtime configuration
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "QC Inspector",
      description: "Automated quality control inspection agent",
      runtime: "sandbox",
      sandbox_config: {
        coding_agents: ["claude-code", "aider"],
        env_vars: [
          { key: "QC_THRESHOLD", value: "0.95" },
          { key: "INSPECTION_MODE", value: "strict" },
        ],
        model: "claude-sonnet-4-20250514",
      },
    });

    // Then the sandbox agent is created
    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateAgentResponse;
    expect(body.agent.name).toBe("QC Inspector");
    expect(body.agent.runtime).toBe("sandbox");

    // And no proxy token is generated (sandbox agents do not use proxy tokens)
    expect(body.proxy_token).toBeUndefined();

    // And the sandbox config is persisted
    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, body.agent.id);
    const detail = (await detailResponse.json()) as AgentDetailResponse;
    expect(detail.agent.sandbox_config).toBeDefined();
    expect(detail.agent.sandbox_config!.coding_agents).toEqual(["claude-code", "aider"]);
    expect(detail.agent.sandbox_config!.env_vars).toEqual([
      { key: "QC_THRESHOLD", value: "0.95" },
      { key: "INSPECTION_MODE", value: "strict" },
    ]);
  }, 120_000);

  it("sandbox creation is blocked when no sandbox provider is configured", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "no-provider");

    // Given the workspace has no sandbox provider configured

    // When the admin tries to create a sandbox agent
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Blocked Agent",
      runtime: "sandbox",
    });

    // Then the creation is blocked with guidance
    expect(response.status).toBeGreaterThanOrEqual(400);
    const errorBody = (await response.json()) as { error: string };
    expect(errorBody.error).toBeDefined();
  }, 120_000);

  it("cloud provider fields (image, snapshot) are accepted for cloud providers only", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "cloud-fields");

    // Given the workspace has a cloud sandbox provider
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `UPDATE $ws SET settings.sandbox_provider = "e2b";`,
      { ws: wsRecord },
    );

    // When the admin creates a sandbox agent with cloud-specific fields
    const response = await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Cloud Agent",
      runtime: "sandbox",
      sandbox_config: {
        image: "custom-python:3.12",
        snapshot: "snapshot-abc123",
        coding_agents: ["claude-code"],
      },
    });

    // Then the creation succeeds with cloud fields stored
    expect(response.status).toBe(201);
    const { agent } = (await response.json()) as CreateAgentResponse;

    const detailResponse = await getAgentDetailViaHttp(baseUrl, user, workspaceId, agent.id);
    const detail = (await detailResponse.json()) as AgentDetailResponse;
    expect(detail.agent.sandbox_config!.image).toBe("custom-python:3.12");
    expect(detail.agent.sandbox_config!.snapshot).toBe("snapshot-abc123");
  }, 120_000);
});

// =============================================================================
// US-06: Filter Agents by Runtime Type
// =============================================================================

describe.skip("Filter Agents by Runtime Type", () => {
  it("filter tabs show correct count per runtime type", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspaceId } = await createAgentTestWorkspace(baseUrl, surreal, "filter-tabs");

    // Given the workspace has agents of multiple runtimes
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `UPDATE $ws SET settings.sandbox_provider = "local";`,
      { ws: wsRecord },
    );

    await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "External 1", runtime: "external",
    });
    await createAgentViaHttp(baseUrl, user, workspaceId, {
      name: "Sandbox 1", runtime: "sandbox",
    });

    // When the admin lists agents
    const response = await listAgentsViaHttp(baseUrl, user, workspaceId);
    expect(response.status).toBe(200);
    const { agents } = (await response.json()) as { agents: AgentListItem[] };

    // Then agents of each runtime are distinguishable
    const external = agents.filter((a) => a.runtime === "external");
    const sandbox = agents.filter((a) => a.runtime === "sandbox");
    expect(external.length).toBeGreaterThanOrEqual(1);
    expect(sandbox.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// =============================================================================
// US-07: Spawn Sandbox Session (placeholder)
// =============================================================================

describe.skip("Spawn Sandbox Session", () => {
  it("spawning a session for a sandbox agent creates an active session record", async () => {
    // Placeholder: session spawning will be tested when orchestrator integration is ready
    expect(true).toBe(true);
  }, 120_000);

  it("spawning a session for an external agent is not allowed", async () => {
    // Placeholder: spawn is sandbox-only
    expect(true).toBe(true);
  }, 120_000);
});

// =============================================================================
// US-08: View Session List on Agent Detail
// =============================================================================

describe.skip("View Session List on Agent Detail", () => {
  it("sessions are listed grouped by status on the agent detail page", async () => {
    // Placeholder: session list rendering on agent detail
    expect(true).toBe(true);
  }, 120_000);

  it("agent detail shows empty state when no sessions exist", async () => {
    // Placeholder: empty session state
    expect(true).toBe(true);
  }, 120_000);
});
