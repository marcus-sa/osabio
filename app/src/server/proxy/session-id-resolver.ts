/**
 * Session ID Resolver — Pure function for determining the effective
 * session ID from identity signals.
 *
 * Port: (IdentitySignals) -> string | undefined
 * No IO, no side effects. Pure selection logic.
 *
 * Priority order:
 * 1. X-Brain-Session header (explicit override)
 * 2. metadata.user_id session_{uuid} pattern (Claude Code format)
 * 3. undefined (no session attribution)
 */

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
