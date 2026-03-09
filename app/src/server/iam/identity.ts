import { RecordId, type Surreal } from "surrealdb";

export async function resolveIdentity(input: {
  surreal: Surreal;
  provider: string;
  providerId: string;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<RecordId<"identity", string> | undefined> {
  const [rows] = await input.surreal.query<[Array<{ id: RecordId<"identity", string> }>]>(
    `SELECT id FROM identity
     WHERE id IN (SELECT VALUE \`in\` FROM member_of WHERE out = $workspace)
       AND identities[WHERE provider = $provider AND id = $providerId]
     LIMIT 1;`,
    {
      workspace: input.workspaceRecord,
      provider: input.provider,
      providerId: input.providerId,
    },
  );

  return rows.length > 0 ? rows[0].id : undefined;
}

/**
 * Resolve identity by email: find person by email, then traverse spoke edge to identity,
 * scoped to workspace via member_of.
 */
export async function resolveByEmail(input: {
  surreal: Surreal;
  email: string;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<RecordId<"identity", string> | undefined> {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (normalizedEmail.length === 0) return undefined;

  // Find person by email, then traverse identity_person spoke to get identity in this workspace
  const [rows] = await input.surreal.query<[Array<{ id: RecordId<"identity", string> }>]>(
    `SELECT id FROM identity
     WHERE id IN (
       SELECT VALUE in FROM identity_person
       WHERE out IN (SELECT VALUE id FROM person WHERE string::lowercase(contact_email) = $email)
     )
       AND id IN (SELECT VALUE in FROM member_of WHERE out = $workspace)
     LIMIT 1;`,
    {
      workspace: input.workspaceRecord,
      email: normalizedEmail,
    },
  );

  return rows.length > 0 ? rows[0].id : undefined;
}
