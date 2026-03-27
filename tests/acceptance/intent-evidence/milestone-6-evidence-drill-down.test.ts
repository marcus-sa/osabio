/**
 * Milestone 6: Evidence Drill-Down -- Entity Detail for Evidence Types
 *
 * Validates:
 * - Entity detail endpoint accepts evidence entity types (observation, policy, learning, git_commit, intent)
 * - Previously, the entity detail handler only accepted a subset of entity types
 *
 * Driving ports:
 *   GET /api/entities/:entityId?workspaceId=:ws (entity detail)
 *   SurrealDB direct (entity creation)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createTestIdentity,
  createEvidenceObservation,
  type OrchestratorTestRuntime,
} from "./intent-evidence-test-kit";

const getRuntime = setupOrchestratorSuite("intent_evidence_m6");

// =============================================================================
// M6-1: Entity detail accepts observation table
// =============================================================================
describe("M6-1: Entity detail for evidence entity types", () => {
  it("accepts observation entityId and returns entity detail", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an observation
    const user = await createTestUser(baseUrl, "m6-evidence-drill");
    const workspace = await createTestWorkspace(baseUrl, user);

    const observation = await createEvidenceObservation(
      surreal,
      workspace.workspaceId,
      {
        text: "Supply chain lead times increasing in APAC region",
        sourceAgent: "observer-agent",
        severity: "warning",
      },
    );

    // When entity detail is requested for the observation
    const entityId = `observation:${observation.observationId}`;
    const response = await fetch(
      `${baseUrl}/api/entities/${entityId}?workspaceId=${workspace.workspaceId}`,
      { headers: user.headers },
    );

    // Then the response is successful
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.entity).toBeDefined();
    expect(body.entity.kind).toBe("observation");
    expect(body.entity.name).toContain("Supply chain lead times");
  });
});
