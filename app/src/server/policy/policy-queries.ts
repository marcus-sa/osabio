import { RecordId, type Surreal } from "surrealdb";
import type { PolicyRecord, PolicyRule, PolicySelector, PolicyStatus } from "./types";

// --- Detail Response Types ---

export type PolicyEdgeInfo = {
  governing: Array<{ identity_id: string; created_at: string }>;
  protects: Array<{ workspace_id: string; created_at: string }>;
};

export type PolicyVersionChainItem = {
  id: string;
  version: number;
  status: string;
  created_at: string;
};

// --- List Response Types ---

export type PolicyListItem = {
  id: string;
  title: string;
  status: string;
  version: number;
  rules_count: number;
  human_veto_required: boolean;
  created_at: string;
  updated_at?: string;
};

// --- Pure Mapping ---

const formatTimestamp = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

const toPolicyListItem = (record: PolicyRecord): PolicyListItem => ({
  id: record.id.id as string,
  title: record.title,
  status: record.status,
  version: record.version,
  rules_count: record.rules?.length ?? 0,
  human_veto_required: record.human_veto_required ?? false,
  created_at: formatTimestamp(record.created_at),
  ...(record.updated_at ? { updated_at: formatTimestamp(record.updated_at) } : {}),
});

// --- Parameter Types ---

type CreatePolicyParams = {
  title: string;
  description?: string;
  selector?: PolicySelector;
  rules: PolicyRule[];
  human_veto_required?: boolean;
  max_ttl?: string;
  createdBy: RecordId<"identity">;
  workspace: RecordId<"workspace">;
  version?: number;
  supersedes?: RecordId<"policy">;
};

// --- Query Functions ---

export async function loadActivePolicies(
  surreal: Surreal,
  identityId: RecordId<"identity">,
  workspaceId: RecordId<"workspace">,
): Promise<PolicyRecord[]> {
  const identityResult = await surreal.query<
    [Array<{ policies: PolicyRecord[] }>]
  >(
    `SELECT ->governing->policy.* AS policies FROM $identity;`,
    { identity: identityId },
  );

  const workspaceResult = await surreal.query<
    [Array<{ policies: PolicyRecord[] }>]
  >(
    `SELECT <-protects<-policy.* AS policies FROM $workspace;`,
    { workspace: workspaceId },
  );

  const identityPolicies = identityResult[0]?.[0]?.policies ?? [];
  const workspacePolicies = workspaceResult[0]?.[0]?.policies ?? [];

  // Deduplicate by policy ID and filter active only
  const seen = new Set<string>();
  const result: PolicyRecord[] = [];
  for (const policy of [...identityPolicies, ...workspacePolicies]) {
    const id = policy.id.id as string;
    if (!seen.has(id) && policy.status === "active") {
      seen.add(id);
      result.push(policy);
    }
  }
  return result;
}

export async function listWorkspacePolicies(
  surreal: Surreal,
  workspace: RecordId<"workspace">,
  statusFilter?: PolicyStatus,
): Promise<PolicyListItem[]> {
  const query = statusFilter
    ? "SELECT * FROM policy WHERE workspace = $ws AND status = $status ORDER BY created_at DESC;"
    : "SELECT * FROM policy WHERE workspace = $ws ORDER BY created_at DESC;";

  const params: Record<string, unknown> = { ws: workspace };
  if (statusFilter) params.status = statusFilter;

  const [rows] = await surreal.query<[PolicyRecord[]]>(query, params);

  return (rows ?? []).map(toPolicyListItem);
}

export async function createPolicy(
  surreal: Surreal,
  params: CreatePolicyParams,
): Promise<{ policyId: string; policyRecord: RecordId<"policy"> }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);

  const content: Record<string, unknown> = {
    title: params.title,
    version: params.version ?? 1,
    status: "draft",
    selector: params.selector ?? {},
    rules: params.rules,
    human_veto_required: params.human_veto_required ?? false,
    created_by: params.createdBy,
    workspace: params.workspace,
    created_at: new Date(),
  };

  if (params.description) content.description = params.description;
  if (params.max_ttl) content.max_ttl = params.max_ttl;
  if (params.supersedes) content.supersedes = params.supersedes;

  await surreal.query("CREATE $policy CONTENT $content;", {
    policy: policyRecord,
    content,
  });

  return { policyId, policyRecord };
}

export async function activatePolicy(
  surreal: Surreal,
  policyId: string,
  creatorId: RecordId<"identity">,
  workspaceId: RecordId<"workspace">,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);

  // Check if this policy supersedes another — if so, atomically supersede the old one
  const policy = await surreal.select<PolicyRecord>(policyRecord);
  const supersededRecord = policy?.supersedes;

  if (supersededRecord) {
    await surreal.query(
      `
      BEGIN TRANSACTION;
        UPDATE $policy SET status = 'active', updated_at = time::now();
        RELATE $creator->governing->$policy SET created_at = time::now();
        RELATE $policy->protects->$workspace SET created_at = time::now();
        UPDATE $oldPolicy SET status = 'superseded', updated_at = time::now();
        DELETE governing WHERE out = $oldPolicy;
        DELETE protects WHERE in = $oldPolicy;
      COMMIT TRANSACTION;
    `,
      {
        policy: policyRecord,
        creator: creatorId,
        workspace: workspaceId,
        oldPolicy: supersededRecord,
      },
    );
  } else {
    await surreal.query(
      `
      BEGIN TRANSACTION;
        UPDATE $policy SET status = 'active', updated_at = time::now();
        RELATE $creator->governing->$policy SET created_at = time::now();
        RELATE $policy->protects->$workspace SET created_at = time::now();
      COMMIT TRANSACTION;
    `,
      {
        policy: policyRecord,
        creator: creatorId,
        workspace: workspaceId,
      },
    );
  }
}

export async function deprecatePolicy(
  surreal: Surreal,
  policyId: string,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);

  await surreal.query(
    `
    BEGIN TRANSACTION;
      UPDATE $policy SET status = 'deprecated', updated_at = time::now();
      DELETE governing WHERE out = $policy;
      DELETE protects WHERE in = $policy;
    COMMIT TRANSACTION;
  `,
    { policy: policyRecord },
  );
}

// --- Detail Query Functions ---

export async function getPolicyById(
  surreal: Surreal,
  policyId: string,
  workspace: RecordId<"workspace">,
): Promise<PolicyRecord | undefined> {
  const policyRecord = new RecordId("policy", policyId);
  const policy = await surreal.select<PolicyRecord>(policyRecord);

  if (!policy || (policy.workspace.id as string) !== (workspace.id as string)) {
    return undefined;
  }

  return policy;
}

export async function getPolicyEdges(
  surreal: Surreal,
  policyId: string,
): Promise<PolicyEdgeInfo> {
  const policyRecord = new RecordId("policy", policyId);

  const [governingRows] = await surreal.query<
    [Array<{ in: RecordId<"identity", string>; created_at: Date }>]
  >(
    "SELECT in, created_at FROM governing WHERE out = $policy;",
    { policy: policyRecord },
  );

  const [protectsRows] = await surreal.query<
    [Array<{ out: RecordId<"workspace", string>; created_at: Date }>]
  >(
    "SELECT out, created_at FROM protects WHERE in = $policy;",
    { policy: policyRecord },
  );

  return {
    governing: (governingRows ?? []).map((e) => ({
      identity_id: e.in.id as string,
      created_at: formatTimestamp(e.created_at),
    })),
    protects: (protectsRows ?? []).map((e) => ({
      workspace_id: e.out.id as string,
      created_at: formatTimestamp(e.created_at),
    })),
  };
}

export function buildVersionChainSingle(policy: PolicyRecord): PolicyVersionChainItem[] {
  return [{
    id: policy.id.id as string,
    version: policy.version,
    status: policy.status,
    created_at: formatTimestamp(policy.created_at),
  }];
}

/** Traverse the supersedes chain to build a full version history. */
export async function buildVersionChain(
  surreal: Surreal,
  policy: PolicyRecord,
): Promise<PolicyVersionChainItem[]> {
  const chain: PolicyVersionChainItem[] = [];
  const seen = new Set<string>();

  // Walk backward via supersedes references to find the root
  const allVersions: PolicyRecord[] = [policy];
  seen.add(policy.id.id as string);

  // Walk backward: follow the supersedes field from the given policy
  let current: PolicyRecord | undefined = policy;
  while (current?.supersedes) {
    const parentId = current.supersedes.id as string;
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parentRecord = new RecordId("policy", parentId);
    const parent = await surreal.select<PolicyRecord>(parentRecord);
    if (!parent) break;
    allVersions.unshift(parent);
    current = parent;
  }

  // Walk forward: find policies that supersede the given policy (newer versions)
  let latestId = policy.id.id as string;
  let searching = true;
  while (searching) {
    const [rows] = await surreal.query<[PolicyRecord[]]>(
      "SELECT * FROM policy WHERE supersedes = $ref LIMIT 1;",
      { ref: new RecordId("policy", latestId) },
    );
    const child = rows?.[0];
    if (child && !seen.has(child.id.id as string)) {
      seen.add(child.id.id as string);
      allVersions.push(child);
      latestId = child.id.id as string;
    } else {
      searching = false;
    }
  }

  // Sort by version number and format
  allVersions.sort((a, b) => a.version - b.version);
  for (const v of allVersions) {
    chain.push({
      id: v.id.id as string,
      version: v.version,
      status: v.status,
      created_at: formatTimestamp(v.created_at),
    });
  }

  return chain;
}

/** Get version chain for the version history endpoint (includes title + rules_count). */
export async function getVersionChain(
  surreal: Surreal,
  policyId: string,
  workspace: RecordId<"workspace">,
): Promise<Array<PolicyVersionChainItem & { title: string; rules_count: number }> | undefined> {
  const policy = await getPolicyById(surreal, policyId, workspace);
  if (!policy) return undefined;

  const chain = await buildVersionChain(surreal, policy);

  // Enrich with title and rules_count from the original records
  const enriched: Array<PolicyVersionChainItem & { title: string; rules_count: number }> = [];
  for (const item of chain) {
    const record = new RecordId("policy", item.id);
    const policyRecord = await surreal.select<PolicyRecord>(record);
    enriched.push({
      ...item,
      title: policyRecord?.title ?? "",
      rules_count: policyRecord?.rules?.length ?? 0,
    });
  }

  return enriched;
}

export async function createPolicyAuditEvent(
  surreal: Surreal,
  eventType: string,
  actor: RecordId<"identity">,
  workspace: RecordId<"workspace">,
  policyId: string,
  version: number,
): Promise<void> {
  const auditId = `audit-${crypto.randomUUID()}`;
  const auditRecord = new RecordId("audit_event", auditId);

  await surreal.query("CREATE $audit CONTENT $content;", {
    audit: auditRecord,
    content: {
      event_type: eventType,
      actor,
      workspace,
      payload: {
        policy_id: policyId,
        policy_version: version,
      },
      severity: "info",
      created_at: new Date(),
    },
  });
}
