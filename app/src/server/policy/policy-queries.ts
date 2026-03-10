import { RecordId, type Surreal } from "surrealdb";
import type { PolicyRecord, PolicyRule, PolicySelector } from "./types";

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
};

// --- Query Functions ---

/**
 * Loads active policies for an identity+workspace via graph traversal.
 * Policies can be reached via identity->governing->policy AND workspace<-protects<-policy.
 * Deduplicates by policy ID and filters to active status only.
 */
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

  const identityPolicies = identityResult[0]?.policies ?? [];
  const workspacePolicies = workspaceResult[0]?.policies ?? [];

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

/**
 * Creates a policy record in draft status with version 1.
 */
export async function createPolicy(
  surreal: Surreal,
  params: CreatePolicyParams,
): Promise<{ policyId: string; policyRecord: RecordId<"policy"> }> {
  const policyId = `policy-${crypto.randomUUID()}`;
  const policyRecord = new RecordId("policy", policyId);

  const content: Record<string, unknown> = {
    title: params.title,
    version: 1,
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

  await surreal.query("CREATE $policy CONTENT $content;", {
    policy: policyRecord,
    content,
  });

  return { policyId, policyRecord };
}

/**
 * Activates a draft policy and creates graph edges.
 * Atomic: status change + governing + protects edges in one transaction.
 */
export async function activatePolicy(
  surreal: Surreal,
  policyId: string,
  creatorId: RecordId<"identity">,
  workspaceId: RecordId<"workspace">,
): Promise<void> {
  const policyRecord = new RecordId("policy", policyId);

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

/**
 * Deprecates a policy and removes all graph edges.
 * Atomic: status change + edge removal in one transaction.
 */
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

/**
 * Creates an audit event for a policy lifecycle action.
 */
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
