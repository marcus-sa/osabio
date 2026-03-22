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
 * Status of a connected account.
 */
export type AccountStatus = "active" | "revoked" | "expired";

/**
 * Input payload for connecting an account via static credentials (API key, basic, bearer).
 * OAuth2 connections are initiated via redirect flow -- no credentials in this payload.
 */
export type ConnectAccountInput = {
  api_key?: string;
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
};

/**
 * SurrealDB record shape for connected_account.
 */
export type ConnectedAccountRecord = {
  id: RecordId<"connected_account", string>;
  identity: RecordId<"identity", string>;
  provider: RecordId<"credential_provider", string>;
  workspace: RecordId<"workspace", string>;
  status: AccountStatus;
  access_token_encrypted?: string;
  refresh_token_encrypted?: string;
  token_expires_at?: Date;
  api_key_encrypted?: string;
  basic_username?: string;
  basic_password_encrypted?: string;
  bearer_token_encrypted?: string;
  scopes?: string[];
  connected_at: Date;
  updated_at: Date;
};

/**
 * API response shape for connected accounts -- never contains plaintext secrets.
 */
export type ConnectedAccountApiResponse = {
  id: string;
  provider_id: string;
  status: AccountStatus;
  has_api_key: boolean;
  has_bearer_token: boolean;
  has_basic_credentials: boolean;
  has_access_token: boolean;
  connected_at: string;
};

/**
 * OAuth2 initiation response -- returned when connecting to an oauth2 provider.
 */
export type OAuth2InitiationResponse = {
  redirect_url: string;
  state: string;
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
