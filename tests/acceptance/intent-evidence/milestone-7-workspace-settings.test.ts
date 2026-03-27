/**
 * Milestone 7: Workspace Settings API -- Evidence Enforcement Configuration
 *
 * Validates:
 * - GET /api/workspaces/:workspaceId/settings returns enforcement mode and thresholds
 * - PUT /api/workspaces/:workspaceId/settings updates enforcement configuration
 *
 * Driving ports:
 *   GET  /api/workspaces/:workspaceId/settings (read settings)
 *   PUT  /api/workspaces/:workspaceId/settings (update settings)
 *   SurrealDB direct (workspace seeding)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  setWorkspaceEnforcementMode,
  setEnforcementThreshold,
  type OrchestratorTestRuntime,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m7");

// =============================================================================
// M7-1: GET/PUT workspace settings round-trip
// =============================================================================
describe("M7-1: Workspace settings API for evidence enforcement config", () => {
  it("returns enforcement mode and thresholds via GET, updates via PUT", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with evidence_enforcement 'soft' and thresholds min_decisions 5 min_tasks 10
    const user = await createTestUser(baseUrl, "m7-settings");
    const workspace = await createTestWorkspace(baseUrl, user);
    await setWorkspaceEnforcementMode(surreal, workspace.workspaceId, "soft");
    await setEnforcementThreshold(surreal, workspace.workspaceId, {
      min_decisions: 5,
      min_tasks: 10,
    });

    // When GET /settings is called
    const getResponse = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      { headers: user.headers },
    );

    // Then the response includes enforcementMode 'soft' and thresholds object
    expect(getResponse.status).toBe(200);
    const settings = await getResponse.json();
    expect(settings.enforcementMode).toBe("soft");
    expect(settings.thresholds).toEqual({
      min_decisions: 5,
      min_tasks: 10,
    });

    // When PUT /settings updates enforcementMode to 'hard'
    const putResponse = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      {
        method: "PUT",
        headers: {
          ...user.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enforcementMode: "hard" }),
      },
    );

    expect(putResponse.status).toBe(200);

    // Then subsequent GET returns 'hard'
    const getAfterUpdate = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/settings`,
      { headers: user.headers },
    );

    expect(getAfterUpdate.status).toBe(200);
    const updatedSettings = await getAfterUpdate.json();
    expect(updatedSettings.enforcementMode).toBe("hard");
    // Thresholds should remain unchanged
    expect(updatedSettings.thresholds).toEqual({
      min_decisions: 5,
      min_tasks: 10,
    });
  });
});
