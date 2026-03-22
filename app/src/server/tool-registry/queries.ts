/**
 * SurrealDB queries for credential_provider and connected_account CRUD.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { CredentialProviderRecord, ConnectedAccountRecord } from "./types";

/**
 * Check if a provider with the given name already exists in the workspace.
 */
export async function providerNameExists(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  name: string,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM credential_provider WHERE workspace = $ws AND name = $name LIMIT 1;`,
    { ws: workspaceRecord, name },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Create a credential_provider record.
 */
export async function createProvider(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  content: Record<string, unknown>,
): Promise<CredentialProviderRecord> {
  const providerId = crypto.randomUUID();
  const providerRecord = new RecordId("credential_provider", providerId);

  const fullContent = {
    ...content,
    workspace: workspaceRecord,
    created_at: new Date(),
  };

  await surreal.query(`CREATE $provider CONTENT $content;`, {
    provider: providerRecord,
    content: fullContent,
  });

  return {
    id: providerRecord,
    ...fullContent,
  } as unknown as CredentialProviderRecord;
}

/**
 * List all credential_providers in a workspace.
 */
export async function listProviders(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<CredentialProviderRecord[]> {
  const results = await surreal.query<[CredentialProviderRecord[]]>(
    `SELECT * FROM credential_provider WHERE workspace = $ws ORDER BY created_at DESC;`,
    { ws: workspaceRecord },
  );
  return results[0] ?? [];
}

// ---------------------------------------------------------------------------
// Connected Account Queries
// ---------------------------------------------------------------------------

/**
 * Fetch a credential_provider by ID.
 */
export async function getProviderById(
  surreal: Surreal,
  providerId: string,
): Promise<CredentialProviderRecord | undefined> {
  const providerRecord = new RecordId("credential_provider", providerId);
  const results = await surreal.query<[CredentialProviderRecord[]]>(
    `SELECT * FROM $provider;`,
    { provider: providerRecord },
  );
  return (results[0] ?? [])[0];
}

/**
 * Check if an active connected_account already exists for identity + provider.
 */
export async function activeAccountExists(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  providerRecord: RecordId<"credential_provider", string>,
): Promise<boolean> {
  const results = await surreal.query<[Array<{ id: RecordId }>]>(
    `SELECT id FROM connected_account WHERE identity = $identity AND provider = $provider AND status = "active" LIMIT 1;`,
    { identity: identityRecord, provider: providerRecord },
  );
  return (results[0] ?? []).length > 0;
}

/**
 * Create a connected_account record with pre-encrypted credential fields.
 */
export async function createConnectedAccount(
  surreal: Surreal,
  content: Record<string, unknown>,
): Promise<ConnectedAccountRecord> {
  const accountId = crypto.randomUUID();
  const accountRecord = new RecordId("connected_account", accountId);

  const fullContent = {
    ...content,
    connected_at: new Date(),
    updated_at: new Date(),
  };

  await surreal.query(`CREATE $account CONTENT $content;`, {
    account: accountRecord,
    content: fullContent,
  });

  return {
    id: accountRecord,
    ...fullContent,
  } as unknown as ConnectedAccountRecord;
}

/**
 * List connected accounts for an identity in a workspace.
 */
export async function listConnectedAccounts(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ConnectedAccountRecord[]> {
  const results = await surreal.query<[ConnectedAccountRecord[]]>(
    `SELECT * FROM connected_account WHERE identity = $identity AND workspace = $ws ORDER BY connected_at DESC;`,
    { identity: identityRecord, ws: workspaceRecord },
  );
  return results[0] ?? [];
}
