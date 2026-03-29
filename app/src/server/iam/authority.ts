import type { ToolExecutionOptions } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import type { ChatToolExecutionContext } from "../tools/types";
import { requireToolContext } from "../tools/helpers";
import { jsonError } from "../http/response";

export type AuthorityAction =
  | "create_decision"
  | "confirm_decision"
  | "create_task"
  | "complete_task"
  | "create_observation"
  | "acknowledge_observation"
  | "resolve_observation"
  | "create_question"
  | "create_suggestion";

export type AuthorityPermission = "auto" | "provisional" | "propose" | "blocked";

export type AuthorizedContext = {
  context: ChatToolExecutionContext;
  permission: AuthorityPermission;
};

export class AuthorityError extends Error {
  constructor(
    public readonly permission: "propose" | "blocked",
    public readonly action: AuthorityAction,
    public readonly agentLabel: string,
  ) {
    const verb = permission === "blocked" ? "not authorized" : "can only propose";
    super(`${agentLabel} is ${verb} for action: ${action}`);
    this.name = "AuthorityError";
  }
}

const ACTOR_DEFAULT_LABEL: Partial<Record<string, string>> = {
  pm_agent: "management",
  analytics_agent: "observer",
};

export async function checkAuthority(input: {
  surreal: Surreal;
  action: AuthorityAction;
  workspaceRecord?: RecordId<"workspace", string>;
  identityRecord?: RecordId<"identity", string>;
}): Promise<AuthorityPermission> {
  // 0. Human bypass: if identity type is human, always allow
  if (input.identityRecord) {
    const [identityRows] = await input.surreal.query<[Array<{ type: string }>]>(
      "SELECT type FROM $record;",
      { record: input.identityRecord },
    );

    if (identityRows.length > 0 && identityRows[0].type === "human") {
      return "auto";
    }

    // 1. Per-identity permission via authorized_to relation
    const [overrideRows] = await input.surreal.query<[Array<{ permission: string }>]>(
      `SELECT permission FROM authorized_to
       WHERE in = $identity
       AND out.action = $action
       LIMIT 1;`,
      { identity: input.identityRecord, action: input.action },
    );

    if (overrideRows.length > 0) {
      return overrideRows[0].permission as AuthorityPermission;
    }
  }

  // 2. Fall back to global default from authority_scope
  const [globalRows] = await input.surreal.query<[Array<{ permission: string }>]>(
    "SELECT permission FROM authority_scope WHERE action = $action AND workspace IS NONE LIMIT 1;",
    { action: input.action },
  );

  if (globalRows.length > 0) {
    return globalRows[0].permission as AuthorityPermission;
  }

  // 3. Fail-safe: no row = blocked
  return "blocked";
}

export async function requireAuthorizedContext(
  options: ToolExecutionOptions,
  action: AuthorityAction,
  deps: { surreal: Surreal },
): Promise<AuthorizedContext> {
  const context = requireToolContext(options);

  // Contract: MCP contexts must never claim human presence
  if (context.humanPresent && context.actor === "mcp") {
    throw new Error("Contract violation: humanPresent must not be true for MCP contexts");
  }

  // Human-present web sessions bypass authority (human IS the authority)
  if (context.humanPresent) {
    return { context, permission: "auto" };
  }

  const agentLabel =
    context.agentType ?? ACTOR_DEFAULT_LABEL[context.actor] ?? "agent";

  const permission = await checkAuthority({
    surreal: deps.surreal,
    action,
    workspaceRecord: context.workspaceRecord,
  });

  if (permission === "blocked") {
    throw new AuthorityError("blocked", action, agentLabel);
  }

  if (permission === "propose") {
    throw new AuthorityError("propose", action, agentLabel);
  }

  // "auto" or "provisional" — caller proceeds (may mark output as provisional)
  return { context, permission };
}

export function checkAuthorityOrError(
  permission: AuthorityPermission,
  action: AuthorityAction,
  actorLabel: string,
): Response | undefined {
  if (permission === "blocked") {
    return jsonError(`${actorLabel} is not authorized for action: ${action}`, 403);
  }
  if (permission === "propose") {
    return jsonError(
      `${actorLabel} can only propose ${action} — requires human approval`,
      403,
    );
  }
  return undefined;
}
