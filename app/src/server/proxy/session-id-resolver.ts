/**
 * Session ID Resolver — Pure function for determining the effective
 * session ID from identity signals.
 *
 * Port: (IdentitySignals) -> string | undefined
 * No IO, no side effects. Pure selection logic.
 *
 * Priority order:
 * 1. X-Osabio-Session header (explicit override)
 * 2. metadata.user_id session_{uuid} pattern (Claude Code format)
 * 3. undefined (no session attribution)
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import type { IdentitySignals } from "./identity-resolver";

/**
 * Resolve the effective session ID from identity signals.
 *
 * Header-based session ID takes precedence over metadata-embedded
 * session ID, allowing explicit session override by the CLI or
 * other tooling.
 */
export function resolveSessionId(
  signals: Pick<IdentitySignals, "sessionHeaderId" | "sessionId" | "workspaceId" | "userHash">,
): string | undefined {
  return signals.sessionHeaderId ?? signals.sessionId;
}

/**
 * Resolve a session ID (which may be a PK or external_session_id) to the
 * actual agent_session record PK. Returns undefined if no matching record.
 */
export async function resolveAgentSessionId(
  surreal: Surreal,
  sessionId: string,
): Promise<string | undefined> {
  const sessionRecord = new RecordId("agent_session", sessionId);
  const [byPk, byExt] = await surreal.query<[
    Array<{ id: RecordId }>,
    Array<{ id: RecordId }>,
  ]>(
    `SELECT id FROM $sess LIMIT 1;
     SELECT id FROM agent_session WHERE external_session_id = $sid LIMIT 1;`,
    { sess: sessionRecord, sid: sessionId },
  );
  const match = byPk[0] ?? byExt[0];
  return match ? (match.id.id as string) : undefined;
}
