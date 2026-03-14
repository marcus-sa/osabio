/**
 * Objective CRUD Acceptance Tests (US-OB-01)
 *
 * Validates that strategic objectives can be created, read, updated,
 * and scoped to workspaces with success criteria and embeddings.
 *
 * Driving ports:
 *   POST /api/workspaces/:workspaceId/objectives  (create)
 *   GET  /api/workspaces/:workspaceId/objectives   (list)
 *   SurrealDB direct queries                       (verification)
 */
import { describe, expect, it } from "bun:test";
import {
  setupObjectiveBehaviorSuite,
  setupObjectiveWorkspace,
  createObjective,
  getObjective,
  listObjectives,
} from "./objective-behavior-test-kit";

const getRuntime = setupObjectiveBehaviorSuite("objective_crud");

// =============================================================================
// Walking Skeleton: Leader creates a strategic objective and sees it in the graph
// =============================================================================
describe("Walking Skeleton: Leader creates a strategic objective (US-OB-01)", () => {
  it("objective is created with title, priority, status, and workspace scope", async () => {
    const { surreal } = getRuntime();

    // Given Elena is working in workspace "BrainOS"
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-skeleton-${crypto.randomUUID()}`,
    );

    // When Elena creates an objective for the Q2 launch
    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Launch MCP Marketplace",
      description: "Launch the MCP marketplace with 10 listed integrations by June 30",
      status: "active",
      priority: "high",
      target_date: "2026-06-30",
      success_criteria: [
        { metric_name: "listed_integrations", target_value: 10, current_value: 0, unit: "count" },
      ],
    });

    // Then the objective is persisted with all fields
    const objective = await getObjective(surreal, objectiveId);
    expect(objective).toBeDefined();
    expect(objective!.title).toBe("Launch MCP Marketplace");
    expect(objective!.status).toBe("active");
    expect(objective!.priority).toBe("high");
    expect(objective!.target_date).toBe("2026-06-30");
    expect(objective!.success_criteria).toHaveLength(1);
    expect(objective!.success_criteria[0].metric_name).toBe("listed_integrations");
    expect(objective!.success_criteria[0].target_value).toBe(10);

    // And the objective is scoped to the workspace
    expect(objective!.workspace.id).toBe(workspaceId);
  }, 60_000);
});

// =============================================================================
// Happy Path Scenarios
// =============================================================================
describe("Happy Path: Objective creation with success criteria (US-OB-01)", () => {
  it("objective stores multiple success criteria as key results", async () => {
    const { surreal } = getRuntime();

    // Given a workspace for tracking objectives
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-kpi-${crypto.randomUUID()}`,
    );

    // When an objective is created with multiple success criteria
    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Improve Infrastructure Reliability",
      priority: "critical",
      success_criteria: [
        { metric_name: "uptime", target_value: 99.9, current_value: 98.5, unit: "percent" },
        { metric_name: "mean_time_to_recovery", target_value: 5, current_value: 45, unit: "minutes" },
        { metric_name: "error_rate", target_value: 0.1, current_value: 2.3, unit: "percent" },
      ],
    });

    // Then all success criteria are persisted
    const objective = await getObjective(surreal, objectiveId);
    expect(objective!.success_criteria).toHaveLength(3);
    expect(objective!.success_criteria.map((sc) => sc.metric_name)).toEqual(
      ["uptime", "mean_time_to_recovery", "error_rate"],
    );
  }, 60_000);

  it("objectives are listed within workspace scope", async () => {
    const { surreal } = getRuntime();

    // Given a workspace with two active objectives
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-list-${crypto.randomUUID()}`,
    );

    await createObjective(surreal, workspaceId, {
      title: "Launch MCP Marketplace",
      status: "active",
    });
    await createObjective(surreal, workspaceId, {
      title: "Improve Infrastructure Reliability",
      status: "active",
    });

    // When Elena lists active objectives
    const objectives = await listObjectives(surreal, workspaceId, "active");

    // Then both objectives are visible
    expect(objectives).toHaveLength(2);
    const titles = objectives.map((o) => o.title);
    expect(titles).toContain("Launch MCP Marketplace");
    expect(titles).toContain("Improve Infrastructure Reliability");
  }, 60_000);
});

// =============================================================================
// Edge Cases
// =============================================================================
describe("Edge Case: Objective without target date (US-OB-01)", () => {
  it("objective is created without target date and remains valid", async () => {
    const { surreal } = getRuntime();

    // Given Elena describes an objective without a specific deadline
    const { workspaceId } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-nodate-${crypto.randomUUID()}`,
    );

    // When the objective is created without a target date
    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Improve Infrastructure Reliability",
      status: "active",
      priority: "medium",
    });

    // Then the objective is created with undefined target_date
    const objective = await getObjective(surreal, objectiveId);
    expect(objective).toBeDefined();
    expect(objective!.title).toBe("Improve Infrastructure Reliability");
    expect(objective!.status).toBe("active");
    expect(objective!.target_date).toBeUndefined();
  }, 60_000);
});

// =============================================================================
// Error / Boundary Scenarios
// =============================================================================
describe("Boundary: Objective workspace isolation (US-OB-01)", () => {
  it("objectives in one workspace are not visible from another workspace", async () => {
    const { surreal } = getRuntime();

    // Given two separate workspaces
    const { workspaceId: wsA } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-iso-a-${crypto.randomUUID()}`,
    );
    const { workspaceId: wsB } = await setupObjectiveWorkspace(
      getRuntime().baseUrl,
      surreal,
      `ws-iso-b-${crypto.randomUUID()}`,
    );

    // And an objective exists only in workspace A
    await createObjective(surreal, wsA, {
      title: "Launch MCP Marketplace",
      status: "active",
    });

    // When listing objectives in workspace B
    const objectivesB = await listObjectives(surreal, wsB);

    // Then no objectives are visible
    expect(objectivesB).toHaveLength(0);

    // And workspace A still has its objective
    const objectivesA = await listObjectives(surreal, wsA);
    expect(objectivesA).toHaveLength(1);
  }, 60_000);

  it("GET /api/workspaces/:wsId/objectives returns workspace-scoped objective list", async () => {
    const { surreal, baseUrl } = getRuntime();

    // Given two workspaces, each with objectives
    const { workspaceId: wsA } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-http-list-a-${crypto.randomUUID()}`,
    );
    const { workspaceId: wsB } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-http-list-b-${crypto.randomUUID()}`,
    );

    await createObjective(surreal, wsA, { title: "Objective A1", status: "active" });
    await createObjective(surreal, wsA, { title: "Objective A2", status: "draft" });
    await createObjective(surreal, wsB, { title: "Objective B1", status: "active" });

    // When listing objectives via HTTP for workspace A
    const response = await fetch(`${baseUrl}/api/workspaces/${wsA}/objectives`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { objectives: Array<{ title: string; status: string; workspace_id: string }> };

    // Then only workspace A objectives are returned
    expect(body.objectives).toHaveLength(2);
    const titles = body.objectives.map((o) => o.title);
    expect(titles).toContain("Objective A1");
    expect(titles).toContain("Objective A2");

    // And workspace B objectives are not leaked
    expect(titles).not.toContain("Objective B1");
  }, 60_000);

  it("GET /api/workspaces/:wsId/objectives?status=active filters by status", async () => {
    const { surreal, baseUrl } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-http-filter-${crypto.randomUUID()}`,
    );

    await createObjective(surreal, workspaceId, { title: "Active One", status: "active" });
    await createObjective(surreal, workspaceId, { title: "Draft One", status: "draft" });

    // When filtering by status=active
    const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/objectives?status=active`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { objectives: Array<{ title: string }> };
    expect(body.objectives).toHaveLength(1);
    expect(body.objectives[0].title).toBe("Active One");
  }, 60_000);

  it("POST /api/workspaces/:wsId/objectives creates an objective", async () => {
    const { surreal, baseUrl } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-http-create-${crypto.randomUUID()}`,
    );

    // When creating via HTTP POST
    const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/objectives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "HTTP Created Objective",
        description: "Created via REST endpoint",
        priority: "high",
        status: "active",
        success_criteria: [
          { metric_name: "api_coverage", target_value: 80, current_value: 0, unit: "percent" },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { objectiveId: string };
    expect(body.objectiveId).toBeDefined();

    // Then the objective is persisted
    const objective = await getObjective(surreal, body.objectiveId);
    expect(objective).toBeDefined();
    expect(objective!.title).toBe("HTTP Created Objective");
    expect(objective!.priority).toBe("high");
    expect(objective!.workspace.id).toBe(workspaceId);
  }, 60_000);

  it("GET /api/workspaces/:wsId/objectives/:id returns single objective", async () => {
    const { surreal, baseUrl } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-http-detail-${crypto.randomUUID()}`,
    );

    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Detail Objective",
      status: "active",
      priority: "critical",
    });

    // When fetching by ID via HTTP
    const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/objectives/${objectiveId}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { objective: { title: string; status: string; priority: string } };
    expect(body.objective.title).toBe("Detail Objective");
    expect(body.objective.status).toBe("active");
    expect(body.objective.priority).toBe("critical");
  }, 60_000);

  it("PUT /api/workspaces/:wsId/objectives/:id updates objective status", async () => {
    const { surreal, baseUrl } = getRuntime();

    const { workspaceId } = await setupObjectiveWorkspace(
      baseUrl,
      surreal,
      `ws-http-update-${crypto.randomUUID()}`,
    );

    const { objectiveId } = await createObjective(surreal, workspaceId, {
      title: "Status Update Objective",
      status: "active",
    });

    // When updating status via HTTP PUT
    const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/objectives/${objectiveId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });

    expect(response.status).toBe(200);

    // Then the status is updated in DB
    const objective = await getObjective(surreal, objectiveId);
    expect(objective!.status).toBe("completed");
  }, 60_000);

  it.skip("duplicate objective is detected by semantic similarity above 0.95", async () => {
    // Requires embedding generation pipeline integration
    // Given objective "Launch MCP Marketplace" exists with embedding
    // When creating an objective with semantically identical title
    // Then no duplicate is created
    // And the user is informed of the existing objective
  });

  it.skip("objective status transitions follow lifecycle rules", async () => {
    // Given an active objective
    // When marking as completed
    // Then status transitions to completed with timestamp
    // When attempting to transition a completed objective back to active
    // Then the transition is rejected
  });
});
