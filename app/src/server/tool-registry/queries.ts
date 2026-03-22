/**
 * SurrealDB queries for credential_provider CRUD.
 */
import { RecordId, type Surreal } from "surrealdb";
import type { CredentialProviderRecord } from "./types";

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
