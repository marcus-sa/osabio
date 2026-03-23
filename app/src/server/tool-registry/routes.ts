/**
 * HTTP routes for credential provider CRUD and account connection.
 *
 * POST /api/workspaces/:workspaceId/providers -- create provider
 * GET  /api/workspaces/:workspaceId/providers -- list providers
 * POST /api/workspaces/:workspaceId/accounts/connect/:providerId -- connect account
 * GET  /api/workspaces/:workspaceId/accounts -- list connected accounts
 *
 * Secrets encrypted before storage, never returned as plaintext.
 */
import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import {
  providerNameExists,
  createProvider,
  listProviders,
  getProviderById,
  activeAccountExists,
  createConnectedAccount,
  listConnectedAccounts,
  revokeConnectedAccount,
} from "./queries";
import { encryptSecret } from "./encryption";
import { buildAuthorizationUrl, storeOAuthState } from "./oauth-flow";
import type {
  CreateProviderInput,
  CredentialProviderRecord,
  ProviderApiResponse,
  ConnectedAccountRecord,
  ConnectedAccountApiResponse,
  ConnectAccountInput,
} from "./types";
import { log } from "../telemetry/logger";

const VALID_AUTH_METHODS = ["oauth2", "api_key", "bearer", "basic"] as const;

// ---------------------------------------------------------------------------
// Session-based identity resolution (browser-facing routes)
// ---------------------------------------------------------------------------

async function resolveIdentityFromSession(
  deps: ServerDependencies,
  request: Request,
): Promise<RecordId<"identity", string> | Response> {
  const session = await deps.auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("authentication required", 401);
  }

  const personRecord = new RecordId("person", session.user.id);
  const [identityRows] = await deps.surreal.query<[RecordId<"identity", string>[]]>(
    "SELECT VALUE in FROM identity_person WHERE out = $person LIMIT 1;",
    { person: personRecord },
  );
  const identityRecord = identityRows[0] as RecordId<"identity", string> | undefined;
  if (!identityRecord) {
    return jsonError("identity not found for user", 500);
  }

  return identityRecord;
}

// ---------------------------------------------------------------------------
// Response mapping -- strip encrypted fields, expose has_client_secret flag
// ---------------------------------------------------------------------------

function toApiResponse(record: CredentialProviderRecord): ProviderApiResponse {
  const response: ProviderApiResponse = {
    id: record.id.id as string,
    name: record.name,
    display_name: record.display_name,
    auth_method: record.auth_method,
    has_client_secret: !!record.client_secret_encrypted,
    created_at: record.created_at instanceof Date
      ? record.created_at.toISOString()
      : String(record.created_at),
  };

  if (record.authorization_url) response.authorization_url = record.authorization_url;
  if (record.token_url) response.token_url = record.token_url;
  if (record.client_id) response.client_id = record.client_id;
  if (record.scopes) response.scopes = record.scopes;
  if (record.api_key_header) response.api_key_header = record.api_key_header;

  return response;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function createProviderRouteHandlers(deps: ServerDependencies) {
  const encryptionKey = deps.config.toolEncryptionKey;

  async function handleCreate(workspaceId: string, request: Request): Promise<Response> {
    let workspaceRecord;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("provider.create", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    let body: CreateProviderInput;
    try {
      body = await request.json() as CreateProviderInput;
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    // Validate required fields
    if (!body.name || typeof body.name !== "string") {
      return jsonError("name is required", 400);
    }
    if (!body.display_name || typeof body.display_name !== "string") {
      return jsonError("display_name is required", 400);
    }
    if (!body.auth_method || !VALID_AUTH_METHODS.includes(body.auth_method as any)) {
      return jsonError(`auth_method must be one of: ${VALID_AUTH_METHODS.join(", ")}`, 400);
    }

    // Check duplicate name within workspace
    const exists = await providerNameExists(deps.surreal, workspaceRecord, body.name);
    if (exists) {
      return jsonError(`provider with name "${body.name}" already exists in workspace`, 409);
    }

    // Build content, encrypting secret if present
    const content: Record<string, unknown> = {
      name: body.name,
      display_name: body.display_name,
      auth_method: body.auth_method,
    };

    if (body.authorization_url) content.authorization_url = body.authorization_url;
    if (body.token_url) content.token_url = body.token_url;
    if (body.client_id) content.client_id = body.client_id;
    if (body.scopes) content.scopes = body.scopes;
    if (body.api_key_header) content.api_key_header = body.api_key_header;

    if (body.client_secret && encryptionKey) {
      content.client_secret_encrypted = encryptSecret(body.client_secret, encryptionKey);
    }

    const record = await createProvider(deps.surreal, workspaceRecord, content);
    return jsonResponse(toApiResponse(record), 201);
  }

  async function handleList(workspaceId: string, _request: Request): Promise<Response> {
    let workspaceRecord;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("provider.list", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const records = await listProviders(deps.surreal, workspaceRecord);
    const providers = records.map(toApiResponse);
    return jsonResponse({ providers }, 200);
  }

  return { handleCreate, handleList };
}

// ---------------------------------------------------------------------------
// Account response mapping -- strip encrypted fields
// ---------------------------------------------------------------------------

function toAccountApiResponse(record: ConnectedAccountRecord): ConnectedAccountApiResponse {
  return {
    id: record.id.id as string,
    provider_id: record.provider.id as string,
    status: record.status,
    has_api_key: !!record.api_key_encrypted,
    has_bearer_token: !!record.bearer_token_encrypted,
    has_basic_credentials: !!record.basic_password_encrypted,
    has_access_token: !!record.access_token_encrypted,
    connected_at: record.connected_at instanceof Date
      ? record.connected_at.toISOString()
      : String(record.connected_at),
  };
}

// ---------------------------------------------------------------------------
// Account connection route handlers
// ---------------------------------------------------------------------------

export function createAccountRouteHandlers(deps: ServerDependencies) {
  const encryptionKey = deps.config.toolEncryptionKey;

  /**
   * POST /api/workspaces/:workspaceId/accounts/connect/:providerId
   *
   * For api_key/bearer/basic: encrypts credentials and creates connected_account.
   * For oauth2: returns redirect URL for user to authorize at provider.
   */
  async function handleConnect(
    workspaceId: string,
    providerId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("account.connect", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    // Look up the credential provider
    const provider = await getProviderById(deps.surreal, providerId);
    if (!provider) {
      return jsonError("credential provider not found", 404);
    }

    // Resolve identity from session (browser) or X-Brain-Identity header (MCP/CLI)
    const identityResult = await resolveIdentityFromSession(deps, request);
    if (identityResult instanceof Response) return identityResult;

    const identityRecord = identityResult;
    const providerRecord = new RecordId("credential_provider", providerId);

    // Check for existing active account
    const alreadyExists = await activeAccountExists(deps.surreal, identityRecord, providerRecord);
    if (alreadyExists) {
      return jsonError("active account already exists for this provider", 409);
    }

    // OAuth2: return redirect URL
    if (provider.auth_method === "oauth2") {
      const state = crypto.randomUUID();
      const baseUrl = request.headers.get("Origin") ?? `${new URL(request.url).origin}`;
      const redirectUri = `${baseUrl}/api/workspaces/${workspaceId}/accounts/oauth2/callback`;

      storeOAuthState(state, {
        providerId,
        identityId: identityRecord.id as string,
        workspaceId,
        createdAt: Date.now(),
      });

      const redirectUrl = buildAuthorizationUrl(provider, redirectUri, state);
      return jsonResponse({ redirect_url: redirectUrl, state }, 200);
    }

    // Static credentials: parse body and encrypt
    let body: ConnectAccountInput;
    try {
      body = await request.json() as ConnectAccountInput;
    } catch {
      return jsonError("invalid JSON body", 400);
    }

    if (!encryptionKey) {
      log.error("account.connect", "TOOL_ENCRYPTION_KEY not configured", undefined, { workspaceId });
      return jsonError("encryption not configured", 500);
    }

    const content: Record<string, unknown> = {
      identity: identityRecord,
      provider: providerRecord,
      workspace: workspaceRecord,
      status: "active",
    };

    switch (provider.auth_method) {
      case "api_key": {
        if (!body.api_key) {
          return jsonError("api_key is required for api_key auth method", 400);
        }
        content.api_key_encrypted = encryptSecret(body.api_key, encryptionKey);
        break;
      }
      case "bearer": {
        if (!body.bearer_token) {
          return jsonError("bearer_token is required for bearer auth method", 400);
        }
        content.bearer_token_encrypted = encryptSecret(body.bearer_token, encryptionKey);
        break;
      }
      case "basic": {
        if (!body.basic_username || !body.basic_password) {
          return jsonError("basic_username and basic_password are required for basic auth method", 400);
        }
        content.basic_username = body.basic_username;
        content.basic_password_encrypted = encryptSecret(body.basic_password, encryptionKey);
        break;
      }
      default:
        return jsonError(`unsupported auth method: ${provider.auth_method}`, 400);
    }

    const record = await createConnectedAccount(deps.surreal, content);
    return jsonResponse(toAccountApiResponse(record), 201);
  }

  /**
   * GET /api/workspaces/:workspaceId/accounts
   *
   * List connected accounts for the authenticated identity.
   */
  async function handleListAccounts(
    workspaceId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("account.list", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const identityResult = await resolveIdentityFromSession(deps, request);
    if (identityResult instanceof Response) return identityResult;

    const identityRecord = identityResult;
    const records = await listConnectedAccounts(deps.surreal, identityRecord, workspaceRecord);
    const accounts = records.map(toAccountApiResponse);
    return jsonResponse({ accounts }, 200);
  }

  /**
   * DELETE /api/workspaces/:workspaceId/accounts/:accountId
   *
   * Revoke a connected account: sets status to "revoked" and hard-deletes
   * all encrypted credential fields. Idempotent.
   */
  async function handleRevoke(
    workspaceId: string,
    accountId: string,
    request: Request,
  ): Promise<Response> {
    let workspaceRecord;
    try {
      workspaceRecord = await resolveWorkspaceRecord(deps.surreal, workspaceId);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status);
      }
      log.error("account.revoke", "Failed to resolve workspace", error, { workspaceId });
      return jsonError("internal error", 500);
    }

    const identityResult = await resolveIdentityFromSession(deps, request);
    if (identityResult instanceof Response) return identityResult;

    const identityRecord = identityResult;
    const accountRecord = new RecordId("connected_account", accountId);

    const updated = await revokeConnectedAccount(
      deps.surreal,
      accountRecord,
      identityRecord,
      workspaceRecord,
    );

    if (!updated) {
      return jsonError("connected account not found", 404);
    }

    return jsonResponse({ status: "revoked" }, 200);
  }

  return { handleConnect, handleListAccounts, handleRevoke };
}
