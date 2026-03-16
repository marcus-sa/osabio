/**
 * Session Upserter — Idempotent DB Adapter
 *
 * Creates or updates an agent_session record in SurrealDB using native UPSERT
 * with the deterministic UUIDv5 session ID from the hash resolver.
 *
 * This replaces the conversation upserter — the proxy groups traces via
 * agent_session (invoked edges), not conversation records.
 *
 * Port: (SessionUpsertInput, Dependencies) -> Promise<string | undefined>
 * Side effects: SurrealDB writes (boundary adapter)
 */

import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";
import { log } from "../telemetry/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionUpsertInput = {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly agent: string;
};

type SessionUpsertDependencies = {
  readonly surreal: Surreal;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert an agent_session record from a content-derived hash.
 * Returns the session PK (string) on success, undefined on failure.
 * Failure never throws -- it logs a warning and returns undefined
 * so the caller can proceed without blocking.
 */
export async function upsertProxySession(
  input: SessionUpsertInput,
  deps: SessionUpsertDependencies,
): Promise<string | undefined> {
  const sessionRecord = new RecordId("agent_session", input.sessionId);
  const workspaceRecord = new RecordId("workspace", input.workspaceId);

  try {
    const results = await deps.surreal.query<[Array<{ id: RecordId }>]>(
      `UPSERT $sess MERGE {
        agent: $agent,
        workspace: $workspace,
        source: "proxy_hash",
        started_at: started_at ?? time::now(),
        last_event_at: time::now(),
        created_at: created_at ?? time::now()
      };`,
      {
        sess: sessionRecord,
        workspace: workspaceRecord,
        agent: input.agent,
      },
    );

    const record = results[0]?.[0];
    if (record) {
      log.info("proxy.session.upserted", "Proxy session upserted via content hash", {
        session_id: input.sessionId,
        workspace_id: input.workspaceId,
      });
      return record.id.id as string;
    }
  } catch (error) {
    log.error(
      "proxy.session.upsert_failed",
      "Failed to upsert proxy session record",
      error,
    );
  }

  return undefined;
}
