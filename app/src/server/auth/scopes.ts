import type { AuthorityAction } from "../iam/authority";
import { jsonError } from "../http/response";
import { OSABIO_SCOPES } from "../../shared/scopes";

export { OSABIO_SCOPES };

export type OsabioScope = keyof typeof OSABIO_SCOPES;

/** Map each authority action to the OAuth scope that gates it */
export const ACTION_SCOPE_MAP: Record<AuthorityAction, OsabioScope> = {
  create_decision: "decision:write",
  confirm_decision: "decision:write",
  create_task: "task:write",
  complete_task: "task:write",
  create_observation: "observation:write",
  acknowledge_observation: "observation:write",
  resolve_observation: "observation:write",
  create_question: "question:write",
  create_suggestion: "task:write",
};

/** All scopes requested by default during osabio init */
export const DEFAULT_CLI_SCOPES = Object.keys(OSABIO_SCOPES).join(" ");

/** Returns 403 Response if the token lacks the required scope, undefined otherwise */
export function requireScope(scopes: Set<string>, required: OsabioScope): Response | undefined {
  if (!scopes.has(required)) {
    return jsonError(`insufficient scope: requires ${required}`, 403);
  }
  return undefined;
}
