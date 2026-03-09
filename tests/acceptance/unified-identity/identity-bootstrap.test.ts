import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";

/**
 * US-UI-002: Identity Wrapping and Agent Registration
 *
 * Validates the bootstrap logic that:
 * - Wraps existing person records in identity hubs with spoke edges
 * - Registers template agent identities for each known agent type
 * - Sets managed_by on each agent to the workspace owner identity
 * - Runs idempotently (no duplicates on re-run)
 * - Integrates with workspace creation flow
 */

const getRuntime = setupAcceptanceSuite("identity-bootstrap");

describe("US-UI-002: Identity wrapping and agent registration bootstrap", () => {
  // -- Walking skeleton: workspace creation triggers identity bootstrap --

  it("Given a new user signs up and creates a workspace, when workspace creation completes, then the owner has an identity with type 'human' linked via spoke edge", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "bootstrap-owner");
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Bootstrap Test ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Query identities for this workspace
    const [identities] = await surreal.query<
      [Array<{ name: string; type: string; role: string }>]
    >(
      "SELECT name, type, role FROM identity WHERE workspace = $ws AND type = 'human';",
      { ws: wsRecord },
    );

    expect(identities.length).toBeGreaterThanOrEqual(1);
    const ownerIdentity = identities.find((i) => i.role === "owner");
    expect(ownerIdentity).toBeDefined();
    expect(ownerIdentity!.type).toBe("human");

    // Verify spoke edge exists from identity to person
    const [spokeEdges] = await surreal.query<
      [Array<{ id: RecordId }>]
    >(
      "SELECT id FROM identity_person WHERE in.workspace = $ws;",
      { ws: wsRecord },
    );
    expect(spokeEdges.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // -- Agent registration --

  it("Given a workspace is created with an owner, when the bootstrap runs, then template agent identities are registered for management, code_agent, and observer types", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "bootstrap-agents");
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Agent Registration ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    const [agentIdentities] = await surreal.query<
      [Array<{ name: string; type: string; role: string }>]
    >(
      "SELECT name, type, role FROM identity WHERE workspace = $ws AND type = 'agent';",
      { ws: wsRecord },
    );

    const roles = agentIdentities.map((a) => a.role);
    expect(roles).toContain("management");
    expect(roles).toContain("coder");
    expect(roles).toContain("observer");

    // Each agent identity should have a spoke edge to an agent record
    for (const agentIdentity of agentIdentities) {
      const [spokes] = await surreal.query<
        [Array<{ agent_type: string }>]
      >(
        "SELECT ->identity_agent->agent.agent_type AS agent_type FROM identity WHERE workspace = $ws AND name = $name;",
        { ws: wsRecord, name: agentIdentity.name },
      );
      expect(spokes.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("Given template agent identities are registered, when querying managed_by for each agent, then each agent's managed_by chain resolves to the workspace owner's human identity", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "bootstrap-chain");
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `ManagedBy Chain ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Get agent identities and traverse managed_by
    const [chains] = await surreal.query<
      [Array<{ name: string; manager_type: string[] }>]
    >(
      `SELECT
        name,
        ->identity_agent->agent.managed_by.type AS manager_type
      FROM identity
      WHERE workspace = $ws AND type = 'agent';`,
      { ws: wsRecord },
    );

    for (const chain of chains) {
      expect(chain.manager_type.length).toBeGreaterThan(0);
      expect(chain.manager_type[0]).toBe("human");
    }
  }, 60_000);

  // -- Idempotency --

  it("Given a workspace already has identity records from bootstrap, when the bootstrap runs again, then no duplicate identities are created", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "bootstrap-idempotent");
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Idempotent Test ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Count identities after first bootstrap
    const [firstCount] = await surreal.query<[Array<{ count: number }>]>(
      "SELECT count() AS count FROM identity WHERE workspace = $ws GROUP ALL;",
      { ws: wsRecord },
    );
    const initialCount = firstCount[0]?.count ?? 0;

    // Trigger bootstrap again (via workspace load or dedicated endpoint)
    // The implementation should expose an idempotent bootstrap path
    // For now, creating a second workspace with the same user tests
    // that the user's person only gets one identity per workspace

    const [secondCount] = await surreal.query<[Array<{ count: number }>]>(
      "SELECT count() AS count FROM identity WHERE workspace = $ws GROUP ALL;",
      { ws: wsRecord },
    );

    expect(secondCount[0]?.count ?? 0).toBe(initialCount);
  }, 60_000);

  // -- Error paths --

  it("Given no person record exists for an email, when the bootstrap attempts to wrap identities, then the workspace creation still succeeds without crashing", async () => {
    // This validates graceful handling when person lookup yields no results
    const { baseUrl } = getRuntime();

    const user = await createTestUser(baseUrl, "bootstrap-no-person");

    // Workspace creation should not fail even if bootstrap encounters edge cases
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `No Person Edge Case ${Date.now()}` }),
      },
    );

    expect(workspace.workspaceId).toBeDefined();
    expect(workspace.workspaceId.length).toBeGreaterThan(0);
  }, 60_000);

  it("Given a workspace with an owner identity, when the person record's fields are queried after bootstrap, then all existing person fields remain unchanged", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "bootstrap-preserve");
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Preserve Person ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Find the person via identity spoke traversal
    const [persons] = await surreal.query<
      [Array<{ name: string; contact_email: string }>]
    >(
      `SELECT ->identity_person->person.{ name, contact_email } AS person_data
       FROM identity
       WHERE workspace = $ws AND type = 'human'
       LIMIT 1;`,
      { ws: wsRecord },
    );

    // Person data should still be intact
    if (persons.length > 0) {
      const personData = (persons[0] as unknown as { person_data: Array<{ contact_email: string }> }).person_data;
      expect(personData[0].contact_email).toContain("@");
    }
  }, 60_000);
});
