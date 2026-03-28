import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { log } from "../telemetry/logger";

// -- Types --

type IdentityType = "human" | "agent";

type AuthorityPermission = "auto" | "provisional" | "blocked";

type AgentTemplate = {
  readonly role: string;
  readonly name: string;
  readonly permissions: Record<string, AuthorityPermission>;
};

// -- Constants --

const MANAGEMENT_PERMISSIONS: Record<string, AuthorityPermission> = {
  create_decision: "provisional",
  confirm_decision: "blocked",
  create_task: "auto",
  complete_task: "auto",
  create_observation: "auto",
  acknowledge_observation: "auto",
  resolve_observation: "auto",
  create_question: "auto",
  create_suggestion: "auto",
  create_intent: "auto",
  submit_intent: "auto",
};

const CODER_PERMISSIONS: Record<string, AuthorityPermission> = {
  create_decision: "provisional",
  confirm_decision: "blocked",
  create_task: "auto",
  complete_task: "auto",
  create_observation: "auto",
  acknowledge_observation: "auto",
  resolve_observation: "blocked",
  create_question: "auto",
  create_suggestion: "auto",
  create_intent: "auto",
  submit_intent: "auto",
};

const OBSERVER_PERMISSIONS: Record<string, AuthorityPermission> = {
  create_decision: "blocked",
  confirm_decision: "blocked",
  create_task: "blocked",
  complete_task: "blocked",
  create_observation: "auto",
  acknowledge_observation: "blocked",
  resolve_observation: "blocked",
  create_question: "auto",
  create_suggestion: "blocked",
  create_intent: "blocked",
  submit_intent: "blocked",
};

const TEMPLATE_AGENTS: readonly AgentTemplate[] = [
  { role: "management", name: "Management Agent", permissions: MANAGEMENT_PERMISSIONS },
  { role: "coder", name: "Code Agent", permissions: CODER_PERMISSIONS },
  { role: "observer", name: "Observer Agent", permissions: OBSERVER_PERMISSIONS },
] as const;

// -- Pure helpers --

const buildIdentityRecord = () => new RecordId("identity", randomUUID());
const buildAgentRecord = () => new RecordId("agent", randomUUID());

// -- Bootstrap pipeline --

/**
 * Bootstrap identity hub-and-spoke for a workspace.
 * Wraps the owner person in an identity hub, creates template agent identities,
 * and links each agent's managed_by to the owner identity.
 *
 * Idempotent: checks for existing identities before creating.
 */
export async function bootstrapWorkspaceIdentities(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  ownerPersonRecord: RecordId<"person", string>,
): Promise<void> {
  const ownerIdentity = await ensureOwnerIdentity(
    surreal,
    workspaceRecord,
    ownerPersonRecord,
  );

  await ensureTemplateAgents(surreal, workspaceRecord, ownerIdentity);

  log.info("identity.bootstrap.completed", "Identity bootstrap completed", {
    workspaceId: workspaceRecord.id as string,
  });
}

// -- Owner identity --

async function findExistingIdentity(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  type: IdentityType,
  role: string,
): Promise<RecordId<"identity", string> | undefined> {
  const [rows] = await surreal.query<
    [Array<{ id: RecordId<"identity", string> }>]
  >(
    "SELECT id FROM identity WHERE workspace = $ws AND type = $type AND role = $role LIMIT 1;",
    { ws: workspaceRecord, type, role },
  );

  return rows.length > 0 ? rows[0].id : undefined;
}

async function resolveOwnerName(
  surreal: Surreal,
  ownerPersonRecord: RecordId<"person", string>,
): Promise<string> {
  const person = await surreal.select<{ name: string }>(ownerPersonRecord);
  return person?.name ?? "Owner";
}

async function ensureOwnerIdentity(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  ownerPersonRecord: RecordId<"person", string>,
): Promise<RecordId<"identity", string>> {
  const existing = await findExistingIdentity(surreal, workspaceRecord, "human", "owner");
  if (existing) {
    log.info("identity.bootstrap.owner_exists", "Owner identity already exists, skipping", {
      workspaceId: workspaceRecord.id as string,
    });
    return existing;
  }

  const ownerName = await resolveOwnerName(surreal, ownerPersonRecord);
  const identityRecord = buildIdentityRecord();
  const now = new Date();

  await surreal.create(identityRecord).content({
    name: ownerName,
    type: "human" as const,
    role: "owner",
    workspace: workspaceRecord,
    created_at: now,
  });

  await surreal
    .relate(identityRecord, new RecordId("identity_person", randomUUID()), ownerPersonRecord, {
      added_at: now,
    })
    .output("after");

  // Create member_of relation from identity to workspace (identity is now the actor for all relations)
  await surreal
    .relate(identityRecord, new RecordId("member_of", randomUUID()), workspaceRecord, {
      role: "owner",
      added_at: now,
    })
    .output("after");

  log.info("identity.bootstrap.owner_created", "Owner identity created", {
    workspaceId: workspaceRecord.id as string,
    identityId: identityRecord.id as string,
  });

  return identityRecord;
}

// -- Template agents --

async function ensureTemplateAgents(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  ownerIdentity: RecordId<"identity", string>,
): Promise<void> {
  for (const template of TEMPLATE_AGENTS) {
    await ensureSingleAgent(surreal, workspaceRecord, ownerIdentity, template);
  }
}

async function ensureSingleAgent(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  ownerIdentity: RecordId<"identity", string>,
  template: AgentTemplate,
): Promise<void> {
  const existing = await findExistingIdentity(surreal, workspaceRecord, "agent", template.role);
  if (existing) {
    log.info("identity.bootstrap.agent_exists", "Agent identity already exists, skipping", {
      workspaceId: workspaceRecord.id as string,
      role: template.role,
    });
    return;
  }

  const now = new Date();
  const agentRecord = buildAgentRecord();
  const identityRecord = buildIdentityRecord();

  // Create agent record with managed_by pointing to owner identity
  await surreal.create(agentRecord).content({
    runtime: "brain" as const,
    name: template.name,
    managed_by: ownerIdentity,
    created_at: now,
  });

  // Create agent identity hub
  await surreal.create(identityRecord).content({
    name: template.name,
    type: "agent" as const,
    role: template.role,
    workspace: workspaceRecord,
    created_at: now,
  });

  // Create spoke edge from identity to agent
  await surreal
    .relate(identityRecord, new RecordId("identity_agent", randomUUID()), agentRecord, {
      added_at: now,
    })
    .output("after");

  // Create member_of edge from identity to workspace
  await surreal
    .relate(identityRecord, new RecordId("member_of", randomUUID()), workspaceRecord, {
      role: "agent",
      added_at: now,
    })
    .output("after");

  // Create authorized_to edges for each action
  await createAuthorityEdges(surreal, identityRecord, template.permissions, now);

  log.info("identity.bootstrap.agent_created", "Agent identity created", {
    workspaceId: workspaceRecord.id as string,
    role: template.role,
  });
}

async function createAuthorityEdges(
  surreal: Surreal,
  identityRecord: RecordId<"identity", string>,
  permissions: Record<string, AuthorityPermission>,
  now: Date,
): Promise<void> {
  // Look up all global authority_scope records
  const [scopeRows] = await surreal.query<[Array<{ id: RecordId<"authority_scope", string>; action: string }>]>(
    "SELECT id, action FROM authority_scope WHERE workspace IS NONE;",
  );

  for (const scopeRow of scopeRows) {
    const permission = permissions[scopeRow.action];
    if (!permission) continue;

    await surreal
      .relate(
        identityRecord,
        new RecordId("authorized_to", randomUUID()),
        scopeRow.id,
        { permission, created_at: now },
      )
      .output("after");
  }
}
