/**
 * Identity bridge — resolve or register device identities in the Brain graph.
 *
 * Effect boundary: these functions interact with SurrealDB.
 * They are adapters, NOT part of the pure core.
 *
 * Port signatures:
 *   resolveDeviceIdentity :: (fingerprint, surreal) -> Promise<DeviceIdentity | undefined>
 *   registerNewDevice     :: (params, surreal) -> Promise<DeviceIdentity>
 */
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeviceIdentity = {
  readonly identityId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly isNewDevice: boolean;
};

type RegisterDeviceParams = {
  readonly publicKeyBase64: string;
  readonly fingerprint: string;
  readonly platform: string;
  readonly family: string;
};

// ---------------------------------------------------------------------------
// Resolve existing device by fingerprint
// ---------------------------------------------------------------------------

/**
 * Look up an agent by device_fingerprint and follow the identity_agent edge
 * to find the identity and workspace.
 *
 * Returns undefined if no agent with this fingerprint exists.
 */
export async function resolveDeviceIdentity(
  fingerprint: string,
  surreal: Surreal,
): Promise<DeviceIdentity | undefined> {
  const [agents] = await surreal.query<
    [Array<{ id: RecordId; workspace: RecordId }>]
  >(
    `SELECT id, workspace FROM identity
       WHERE id IN (SELECT VALUE in FROM identity_agent WHERE out IN (
         SELECT VALUE id FROM agent WHERE device_fingerprint = $fp
       ))
       LIMIT 1;`,
    { fp: fingerprint },
  );

  if (!agents || agents.length === 0) return undefined;

  const identity = agents[0];
  const identityId = identity.id.id as string;
  const workspaceId = (identity.workspace as RecordId).id as string;

  // Get the agent id
  const [agentRows] = await surreal.query<
    [Array<{ id: RecordId }>]
  >(
    `SELECT VALUE id FROM agent WHERE device_fingerprint = $fp LIMIT 1;`,
    { fp: fingerprint },
  );

  const agentId = agentRows && agentRows.length > 0
    ? (agentRows[0] as unknown as RecordId).id as string
    : identityId;

  return {
    identityId,
    workspaceId,
    agentId,
    isNewDevice: false,
  };
}

// ---------------------------------------------------------------------------
// Register new device — creates agent, identity, edges
// ---------------------------------------------------------------------------

/**
 * Register a brand new device in the Brain graph.
 *
 * Creates:
 * 1. A default workspace (or uses existing default)
 * 2. An identity record (type: 'agent')
 * 3. An agent record (agent_type: 'openclaw') with device_fingerprint + public key
 * 4. An identity_agent edge
 * 5. A member_of edge (identity -> workspace)
 *
 * Returns the resolved identity for the connect handler.
 */
export async function registerNewDevice(
  params: RegisterDeviceParams,
  surreal: Surreal,
): Promise<DeviceIdentity> {
  const workspaceRecord = new RecordId("workspace", crypto.randomUUID());
  const identityRecord = new RecordId("identity", crypto.randomUUID());
  const agentRecord = new RecordId("agent", crypto.randomUUID());
  const now = new Date();

  // Create workspace with all required schema fields
  await surreal.create(workspaceRecord).content({
    name: "OpenClaw Device Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
    updated_at: now,
  });

  // Create identity
  await surreal.create(identityRecord).content({
    name: `openclaw-device-${params.fingerprint.slice(0, 8)}`,
    type: "agent",
    workspace: workspaceRecord,
    created_at: now,
  });

  // Create agent with device fields
  await surreal.create(agentRecord).content({
    agent_type: "openclaw",
    managed_by: identityRecord,
    device_fingerprint: params.fingerprint,
    device_public_key: params.publicKeyBase64,
    device_platform: params.platform,
    device_family: params.family,
    created_at: now,
  });

  // Create identity_agent edge
  await surreal
    .relate(identityRecord, new RecordId("identity_agent", crypto.randomUUID()), agentRecord, {
      added_at: now,
    })
    .output("after");

  // Create member_of edge
  await surreal
    .relate(identityRecord, new RecordId("member_of", crypto.randomUUID()), workspaceRecord, {
      added_at: now,
    })
    .output("after");

  return {
    identityId: identityRecord.id as string,
    workspaceId: workspaceRecord.id as string,
    agentId: agentRecord.id as string,
    isNewDevice: true,
  };
}
