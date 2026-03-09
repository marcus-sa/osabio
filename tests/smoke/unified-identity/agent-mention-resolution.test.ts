import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { setupSmokeSuite } from "../smoke-test-kit";
import {
  resolveWorkspaceIdentity,
  isAmbiguousAgentMention,
} from "../../../app/src/server/extraction/identity-resolution";

/**
 * US-UI-007: Agent Mention Resolution in Extraction Pipeline
 *
 * Validates that resolveWorkspaceIdentity recognizes agent references:
 * - Role-based mentions ("the PM agent") resolve to the correct identity
 * - Name-based mentions ("Code Agent") resolve to the correct identity
 * - Ambiguous mentions ("an agent") do not create false-positive attributions
 * - Non-existent agent references do not create phantom identity records
 * - Resolution is scoped to the current workspace
 */

const getRuntime = setupSmokeSuite("agent-mention-resolution");

/**
 * Seeds a workspace with agent identities for testing.
 * Returns the workspace record and identity IDs.
 */
async function seedAgentIdentities(surreal: ReturnType<typeof getRuntime>["surreal"]) {
  const workspaceId = `ws-agent-test-${Date.now()}`;
  const wsRecord = new RecordId("workspace", workspaceId);

  // Create workspace
  await surreal.query(
    "CREATE $ws CONTENT { name: 'Agent Resolution Test', status: 'active', onboarding_complete: true, onboarding_turn_count: 0, onboarding_summary_pending: false, onboarding_started_at: time::now(), created_at: time::now() };",
    { ws: wsRecord },
  );

  // Create PM Agent identity (role: management)
  const pmIdentityId = `pm-agent-${Date.now()}`;
  const pmIdentityRecord = new RecordId("identity", pmIdentityId);
  await surreal.query(
    "CREATE $id CONTENT { name: 'PM Agent', type: 'agent', role: 'management', workspace: $ws, created_at: time::now() };",
    { id: pmIdentityRecord, ws: wsRecord },
  );

  // Create Code Agent identity (role: coder)
  const codeIdentityId = `code-agent-${Date.now()}`;
  const codeIdentityRecord = new RecordId("identity", codeIdentityId);
  await surreal.query(
    "CREATE $id CONTENT { name: 'Code Agent', type: 'agent', role: 'coder', workspace: $ws, created_at: time::now() };",
    { id: codeIdentityRecord, ws: wsRecord },
  );

  // Create Observer Agent identity (role: observer)
  const observerIdentityId = `observer-agent-${Date.now()}`;
  const observerIdentityRecord = new RecordId("identity", observerIdentityId);
  await surreal.query(
    "CREATE $id CONTENT { name: 'Observer Agent', type: 'agent', role: 'observer', workspace: $ws, created_at: time::now() };",
    { id: observerIdentityRecord, ws: wsRecord },
  );

  // Create a second workspace with its own PM agent (for cross-workspace scoping)
  const otherWsId = `ws-other-${Date.now()}`;
  const otherWsRecord = new RecordId("workspace", otherWsId);
  await surreal.query(
    "CREATE $ws CONTENT { name: 'Other Workspace', status: 'active', onboarding_complete: true, onboarding_turn_count: 0, onboarding_summary_pending: false, onboarding_started_at: time::now(), created_at: time::now() };",
    { ws: otherWsRecord },
  );

  const otherPmId = `other-pm-${Date.now()}`;
  const otherPmRecord = new RecordId("identity", otherPmId);
  await surreal.query(
    "CREATE $id CONTENT { name: 'PM Agent', type: 'agent', role: 'management', workspace: $ws, created_at: time::now() };",
    { id: otherPmRecord, ws: otherWsRecord },
  );

  return {
    wsRecord,
    otherWsRecord,
    pmIdentityRecord,
    codeIdentityRecord,
    observerIdentityRecord,
    otherPmRecord,
  };
}

describe("US-UI-007: Agent mention resolution in identity-resolution", () => {
  // -- Happy path: role-based mention --

  it("Given PM Agent identity exists, when 'the PM agent' is resolved, then it returns the PM Agent identity", async () => {
    const { surreal } = getRuntime();
    const { wsRecord, pmIdentityRecord } = await seedAgentIdentities(surreal);

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: wsRecord,
      identityName: "the PM agent",
    });

    expect(result).toBeDefined();
    expect(result!.id).toBe(pmIdentityRecord.id);
  }, 30_000);

  // -- Happy path: name-based mention --

  it("Given Code Agent identity exists, when 'Code Agent' is resolved, then it returns the Code Agent identity", async () => {
    const { surreal } = getRuntime();
    const { wsRecord, codeIdentityRecord } = await seedAgentIdentities(surreal);

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: wsRecord,
      identityName: "Code Agent",
    });

    expect(result).toBeDefined();
    expect(result!.id).toBe(codeIdentityRecord.id);
  }, 30_000);

  // -- Happy path: case-insensitive role mention --

  it("Given PM Agent identity exists, when 'management agent' is resolved, then it returns the PM Agent identity via role match", async () => {
    const { surreal } = getRuntime();
    const { wsRecord, pmIdentityRecord } = await seedAgentIdentities(surreal);

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: wsRecord,
      identityName: "management agent",
    });

    expect(result).toBeDefined();
    expect(result!.id).toBe(pmIdentityRecord.id);
  }, 30_000);

  // -- Error path: ambiguous mention --

  it("Given multiple agent identities exist, when 'an agent' is resolved, then it returns undefined (no false positive)", async () => {
    const { surreal } = getRuntime();
    const { wsRecord } = await seedAgentIdentities(surreal);

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: wsRecord,
      identityName: "an agent",
    });

    expect(result).toBeUndefined();
  }, 30_000);

  it("Given multiple agent identities exist, when 'the agent' is resolved, then it returns undefined (too vague)", async () => {
    const { surreal } = getRuntime();
    const { wsRecord } = await seedAgentIdentities(surreal);

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: wsRecord,
      identityName: "the agent",
    });

    expect(result).toBeUndefined();
  }, 30_000);

  // -- Error path: non-existent agent --

  it("Given no 'Design Agent' identity exists, when 'Design Agent' is resolved, then it returns undefined and creates no phantom record", async () => {
    const { surreal } = getRuntime();
    const { wsRecord } = await seedAgentIdentities(surreal);

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: wsRecord,
      identityName: "Design Agent",
    });

    expect(result).toBeUndefined();

    // Verify no phantom record was created
    const [designAgents] = await surreal.query<
      [Array<{ name: string }>]
    >(
      "SELECT name FROM identity WHERE workspace = $ws AND name = 'Design Agent';",
      { ws: wsRecord },
    );
    expect(designAgents.length).toBe(0);
  }, 30_000);

  // -- Boundary: workspace scoping --

  it("Given PM Agent exists in workspace A but not workspace B, when resolved in a third workspace, then it returns undefined", async () => {
    const { surreal } = getRuntime();
    const { otherWsRecord } = await seedAgentIdentities(surreal);

    // Create yet another workspace with no agent identities
    const emptyWsId = `ws-empty-${Date.now()}`;
    const emptyWsRecord = new RecordId("workspace", emptyWsId);
    await surreal.query(
      "CREATE $ws CONTENT { name: 'Empty Workspace', status: 'active', onboarding_complete: true, onboarding_turn_count: 0, onboarding_summary_pending: false, onboarding_started_at: time::now(), created_at: time::now() };",
      { ws: emptyWsRecord },
    );

    const result = await resolveWorkspaceIdentity({
      surreal,
      workspaceRecord: emptyWsRecord,
      identityName: "PM Agent",
    });

    expect(result).toBeUndefined();
  }, 30_000);

  // -- Pure function: ambiguity detection --

  it("isAmbiguousAgentMention correctly classifies ambiguous vs specific mentions", () => {
    // Ambiguous - should return true
    expect(isAmbiguousAgentMention("an agent")).toBe(true);
    expect(isAmbiguousAgentMention("the agent")).toBe(true);
    expect(isAmbiguousAgentMention("some agent")).toBe(true);
    expect(isAmbiguousAgentMention("An Agent")).toBe(true);

    // Specific - should return false
    expect(isAmbiguousAgentMention("the PM agent")).toBe(false);
    expect(isAmbiguousAgentMention("Code Agent")).toBe(false);
    expect(isAmbiguousAgentMention("management agent")).toBe(false);
    expect(isAmbiguousAgentMention("Observer Agent")).toBe(false);
  });
});
