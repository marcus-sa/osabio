/**
 * HTTP routes for credential provider CRUD.
 *
 * POST /api/workspaces/:workspaceId/providers -- create provider
 * GET  /api/workspaces/:workspaceId/providers -- list providers
 *
 * Secrets encrypted before storage, never returned as plaintext.
 */
import { HttpError } from "../http/errors";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import { providerNameExists, createProvider, listProviders } from "./queries";
import { encryptSecret } from "./encryption";
import type { CreateProviderInput, CredentialProviderRecord, ProviderApiResponse } from "./types";
import { log } from "../telemetry/logger";

const VALID_AUTH_METHODS = ["oauth2", "api_key", "bearer", "basic"] as const;

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
