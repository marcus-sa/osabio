/**
 * Credential provider domain types.
 *
 * Auth method variants: oauth2, api_key, bearer, basic.
 * Encrypted fields use _encrypted suffix (ADR-068).
 */
import type { RecordId } from "surrealdb";

export type AuthMethod = "oauth2" | "api_key" | "bearer" | "basic";

/**
 * Input payload for creating a credential provider via API.
 * client_secret is plaintext here -- encrypted before storage.
 */
export type CreateProviderInput = {
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  api_key_header?: string;
};

/**
 * SurrealDB record shape for credential_provider.
 */
export type CredentialProviderRecord = {
  id: RecordId<"credential_provider", string>;
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  workspace: RecordId<"workspace", string>;
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  client_secret_encrypted?: string;
  scopes?: string[];
  api_key_header?: string;
  created_at: Date;
};

/**
 * API response shape -- never contains plaintext secrets.
 */
export type ProviderApiResponse = {
  id: string;
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  has_client_secret: boolean;
  scopes?: string[];
  api_key_header?: string;
  created_at: string;
};
