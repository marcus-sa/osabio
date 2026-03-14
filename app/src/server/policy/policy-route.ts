import { RecordId } from "surrealdb";
import { HttpError } from "../http/errors";
import { logError } from "../http/observability";
import { jsonError, jsonResponse } from "../http/response";
import type { ServerDependencies } from "../runtime/types";
import { resolveWorkspaceRecord } from "../workspace/workspace-scope";
import type { PolicyRecord } from "./types";

// ---------------------------------------------------------------------------
// Pure identity guard
// ---------------------------------------------------------------------------

/** Agents are denied mutation access to policies. */
const isAgentIdentity = (identityType: string): boolean =>
  identityType === "agent";

// ---------------------------------------------------------------------------
// Identity resolution (session -> person -> identity)
// ---------------------------------------------------------------------------

type IdentityInfo = {
  identityRecord: RecordId<"identity", string>;
  identityType: string;
};

async function resolveIdentityFromSession(
  deps: ServerDependencies,
  request: Request,
): Promise<IdentityInfo | Response> {
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

  const [typeRows] = await deps.surreal.query<[Array<{ type: string }>]>(
    "SELECT type FROM $identity;",
    { identity: identityRecord },
  );
  const identityType = typeRows[0]?.type;
  if (!identityType) {
    return jsonError("identity type not found", 500);
  }

  return { identityRecord, identityType };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function resolveWorkspace(
  deps: ServerDependencies,
  workspaceId: string,
  logEvent: string,
): Promise<RecordId<"workspace", string> | Response> {
  try {
    return await resolveWorkspaceRecord(deps.surreal, workspaceId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.message, error.status);
    }
    logError(logEvent, "Failed to resolve workspace", error, { workspaceId });
    return jsonError("failed to resolve workspace", 500);
  }
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createPolicyRouteHandlers(deps: ServerDependencies) {
  return {
    handleList: (workspaceId: string, request: Request) =>
      handleListPolicies(deps, workspaceId, request),
    handleDetail: (workspaceId: string, policyId: string, request: Request) =>
      handlePolicyDetail(deps, workspaceId, policyId, request),
    handleCreate: (workspaceId: string, request: Request) =>
      handleCreatePolicy(deps, workspaceId, request),
    handleActivate: (workspaceId: string, policyId: string, request: Request) =>
      handleActivatePolicy(deps, workspaceId, policyId, request),
    handleDeprecate: (workspaceId: string, policyId: string, request: Request) =>
      handleDeprecatePolicy(deps, workspaceId, policyId, request),
    handleCreateVersion: (workspaceId: string, policyId: string, request: Request) =>
      handleCreatePolicyVersion(deps, workspaceId, policyId, request),
  };
}

// ---------------------------------------------------------------------------
// Mutation guard: resolves identity and rejects agents
// ---------------------------------------------------------------------------

async function requireHumanIdentity(
  deps: ServerDependencies,
  request: Request,
): Promise<IdentityInfo | Response> {
  const identityOrError = await resolveIdentityFromSession(deps, request);
  if (isResponse(identityOrError)) return identityOrError;

  if (isAgentIdentity(identityOrError.identityType)) {
    return jsonError("agents cannot modify policies", 403);
  }

  return identityOrError;
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/policies
// ---------------------------------------------------------------------------

async function handleListPolicies(
  deps: ServerDependencies,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.list.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status") ?? undefined;

    const query = statusFilter
      ? "SELECT * FROM policy WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;"
      : "SELECT * FROM policy WHERE workspace = $ws ORDER BY created_at DESC;";

    const params: Record<string, unknown> = { ws: workspaceRecord };
    if (statusFilter) params.status = statusFilter;

    const [rows] = await deps.surreal.query<[PolicyRecord[]]>(query, params);

    const policies = (rows ?? []).map((p) => ({
      id: p.id.id as string,
      title: p.title,
      status: p.status,
      version: p.version,
      rules_count: p.rules?.length ?? 0,
      human_veto_required: p.human_veto_required ?? false,
      created_at: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
      ...(p.updated_at ? {
        updated_at: p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
      } : {}),
    }));

    return jsonResponse({ policies }, 200);
  } catch (error) {
    logError("policy.list.failed", "Failed to list policies", error, { workspaceId });
    return jsonError("failed to list policies", 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:workspaceId/policies/:policyId
// ---------------------------------------------------------------------------

async function handlePolicyDetail(
  deps: ServerDependencies,
  workspaceId: string,
  policyId: string,
  _request: Request,
): Promise<Response> {
  const workspaceOrError = await resolveWorkspace(deps, workspaceId, "policy.detail.workspace_resolve.failed");
  if (isResponse(workspaceOrError)) return workspaceOrError;
  const workspaceRecord = workspaceOrError;

  try {
    const policyRecord = new RecordId("policy", policyId);
    const policy = await deps.surreal.select<PolicyRecord>(policyRecord);

    if (!policy || (policy.workspace.id as string) !== (workspaceRecord.id as string)) {
      return jsonError("policy not found", 404);
    }

    // Fetch edges
    const [governingRows] = await deps.surreal.query<[Array<{ in: RecordId<"identity", string>; created_at: Date }>]>(
      "SELECT in, created_at FROM governing WHERE out = $policy;",
      { policy: policyRecord },
    );
    const [protectsRows] = await deps.surreal.query<[Array<{ out: RecordId<"workspace", string>; created_at: Date }>]>(
      "SELECT out, created_at FROM protects WHERE in = $policy;",
      { policy: policyRecord },
    );

    return jsonResponse({
      policy: {
        id: policy.id.id as string,
        title: policy.title,
        ...(policy.description ? { description: policy.description } : {}),
        version: policy.version,
        status: policy.status,
        selector: policy.selector ?? {},
        rules: policy.rules ?? [],
        human_veto_required: policy.human_veto_required ?? false,
        ...(policy.max_ttl ? { max_ttl: policy.max_ttl } : {}),
        ...(policy.supersedes ? { supersedes: policy.supersedes.id as string } : {}),
        created_at: policy.created_at instanceof Date ? policy.created_at.toISOString() : String(policy.created_at),
        ...(policy.updated_at ? {
          updated_at: policy.updated_at instanceof Date ? policy.updated_at.toISOString() : String(policy.updated_at),
        } : {}),
      },
      edges: {
        governing: (governingRows ?? []).map((e) => ({
          identity_id: e.in.id as string,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
        protects: (protectsRows ?? []).map((e) => ({
          workspace_id: e.out.id as string,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
      },
      version_chain: [],
    }, 200);
  } catch (error) {
    logError("policy.detail.failed", "Failed to get policy detail", error, { workspaceId, policyId });
    return jsonError("failed to get policy detail", 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/policies (stub - guarded)
// ---------------------------------------------------------------------------

async function handleCreatePolicy(
  deps: ServerDependencies,
  _workspaceId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  return jsonError("not implemented", 501);
}

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:workspaceId/policies/:policyId/activate (stub - guarded)
// ---------------------------------------------------------------------------

async function handleActivatePolicy(
  deps: ServerDependencies,
  _workspaceId: string,
  _policyId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  return jsonError("not implemented", 501);
}

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:workspaceId/policies/:policyId/deprecate (stub - guarded)
// ---------------------------------------------------------------------------

async function handleDeprecatePolicy(
  deps: ServerDependencies,
  _workspaceId: string,
  _policyId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  return jsonError("not implemented", 501);
}

// ---------------------------------------------------------------------------
// POST /api/workspaces/:workspaceId/policies/:policyId/versions (stub - guarded)
// ---------------------------------------------------------------------------

async function handleCreatePolicyVersion(
  deps: ServerDependencies,
  _workspaceId: string,
  _policyId: string,
  request: Request,
): Promise<Response> {
  const guardResult = await requireHumanIdentity(deps, request);
  if (isResponse(guardResult)) return guardResult;

  return jsonError("not implemented", 501);
}
