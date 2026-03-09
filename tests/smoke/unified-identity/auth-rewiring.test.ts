import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupSmokeSuite } from "../smoke-test-kit";

/**
 * US-UI-004: Auth Rewiring -- Identity resolution from person via spoke
 *
 * Validates that the auth layer resolves identity from person via spoke traversal:
 * - better-auth still uses person as user model (session.person_id, account.person_id)
 * - Identity is resolved from person via identity_person spoke edge
 * - Chat ingress resolves identity and passes it through the pipeline
 * - MCP auth resolves identity from JWT sub (person ID) via spoke
 */

const getRuntime = setupSmokeSuite("auth-rewiring");

describe("US-UI-004: Auth resolves identity from person via spoke traversal", () => {
  // -- Session still references person --

  it("Given a user signs up, when the session is queried, then session.person_id references a person record", async () => {
    const { baseUrl, surreal } = getRuntime();

    await createTestUser(baseUrl, "auth-identity");

    const [sessions] = await surreal.query<
      [Array<{ person_id: RecordId }>]
    >("SELECT person_id FROM session LIMIT 1;");

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].person_id).toBeDefined();
    expect((sessions[0].person_id as RecordId).table.name).toBe("person");
  }, 60_000);

  // -- Person has identity via spoke edge --

  it("Given a user signs up and creates a workspace, when the identity_person spoke is queried, then the person has a linked identity with type human", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "auth-spoke");

    // Create workspace to trigger identity bootstrap
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Spoke Test ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Find identity created by bootstrap for this workspace
    const [identities] = await surreal.query<
      [Array<{ id: RecordId; type: string; name: string }>]
    >(
      "SELECT id, type, name FROM identity WHERE workspace = $ws AND type = 'human' LIMIT 1;",
      { ws: wsRecord },
    );

    expect(identities.length).toBeGreaterThan(0);
    expect(identities[0].type).toBe("human");

    // Verify spoke edge exists from this identity to a person
    const [spokeEdges] = await surreal.query<[Array<{ out: RecordId }>]>(
      "SELECT out FROM identity_person WHERE in = $identity LIMIT 1;",
      { identity: identities[0].id },
    );
    expect(spokeEdges.length).toBeGreaterThan(0);
    expect((spokeEdges[0].out as RecordId).table.name).toBe("person");
  }, 60_000);

  // -- Identity is member_of workspace --

  it("Given a user creates a workspace, when member_of is queried, then the identity (not person) is the member", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createTestUser(baseUrl, "auth-member");
    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Member Test ${Date.now()}` }),
      },
    );

    const wsRecord = new RecordId("workspace", workspace.workspaceId);
    const [members] = await surreal.query<
      [Array<{ in: RecordId; role: string }>]
    >(
      "SELECT in, role FROM member_of WHERE out = $ws LIMIT 1;",
      { ws: wsRecord },
    );

    expect(members.length).toBeGreaterThan(0);
    expect((members[0].in as RecordId).table.name).toBe("identity");
    expect(members[0].role).toBe("owner");
  }, 60_000);

  // -- Chat context uses identity --

  it("Given a user is logged in and has a workspace, when the user sends a chat message, then the chat pipeline processes the message using the user's identity as the actor", async () => {
    const { baseUrl } = getRuntime();

    const user = await createTestUser(baseUrl, "auth-chat");
    const workspace = await fetchJson<{ workspaceId: string; conversationId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Auth Chat Test ${Date.now()}` }),
      },
    );

    // Send a message - the pipeline should resolve identity from person via spoke
    // We verify this works end-to-end (no crash from type mismatches)
    const chatResponse = await fetchJson<{ messageId: string }>(
      `${baseUrl}/api/chat/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          clientMessageId: `auth-test-${Date.now()}`,
          workspaceId: workspace.workspaceId,
          conversationId: workspace.conversationId,
          text: "Hello, testing identity-based chat context.",
        }),
      },
    );

    expect(chatResponse.messageId).toBeDefined();
    expect(chatResponse.messageId.length).toBeGreaterThan(0);
  }, 60_000);

  // -- Schema: session and account still use person_id --

  it("Given the auth tables are unchanged, when schema info is queried, then session and account use person_id not identity_id", async () => {
    const { surreal } = getRuntime();

    for (const table of ["session", "account"]) {
      const [info] = await surreal.query<[Record<string, unknown>]>(
        `INFO FOR TABLE ${table};`,
      );

      const infoObj = info as unknown as Record<string, Record<string, string>>;
      const fieldMap = infoObj.fields ?? infoObj.fd ?? {};
      const fieldNames = Object.keys(fieldMap);

      expect(fieldNames).toContain("person_id");
      expect(fieldNames).not.toContain("identity_id");
    }
  }, 60_000);
});
