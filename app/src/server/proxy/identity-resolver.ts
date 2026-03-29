/**
 * Identity Resolver — Pure function for extracting identity signals
 * from Claude Code metadata and X-Brain-* headers.
 *
 * Port: (IdentityInput) -> IdentitySignals
 * No IO, no side effects. Pure transformation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdentityInput = {
  metadataUserId?: string;
  workspaceHeader?: string;
  taskHeader?: string;
  agentTypeHeader?: string;
  sessionHeader?: string;
  /** Identity ID resolved from a proxy token (Brain auth mode) */
  proxyTokenIdentityId?: string;
  userAgent?: string;
};

export type IdentitySignals = {
  userHash?: string;
  accountId?: string;
  sessionId?: string;
  sessionHeaderId?: string;
  workspaceId?: string;
  taskId?: string;
  agentType?: string;
  /** Identity ID from a proxy token (Brain auth mode) */
  proxyTokenIdentityId?: string;
  userAgent?: string;
};

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Parse Claude Code's metadata.user_id format:
 * "user_<hash>_account_<uuid>_session_<uuid>"
 *
 * Returns extracted fields, or treats the entire string as an opaque user hash
 * when it doesn't match the expected pattern.
 */
function parseMetadataUserId(userId?: string): {
  userHash?: string;
  accountId?: string;
  sessionId?: string;
} {
  if (!userId) return {};

  const match = userId.match(
    /^user_([\w-]+)_account_([\w-]+)_session_([\w-]+)$/,
  );

  if (!match) return { userHash: userId };

  return {
    userHash: match[1],
    accountId: match[2],
    sessionId: match[3],
  };
}

/**
 * Resolve identity signals from request metadata and headers.
 *
 * Combines Claude Code metadata.user_id parsing with X-Brain-* headers
 * to produce a complete identity picture. Missing signals degrade
 * gracefully — each field is optional.
 */
/**
 * Derive the agent name from identity signals.
 *
 * Priority:
 * 1. X-Osabio-Agent-Type header (explicit)
 * 2. User-Agent containing "claude-cli" → "claude-cli"
 * 3. "proxy" (unknown caller)
 */
export function resolveAgentName(signals: Pick<IdentitySignals, "agentType" | "userAgent">): string {
  if (signals.agentType) return signals.agentType;
  if (signals.userAgent?.includes("claude-cli")) return "claude-cli";
  return "proxy";
}

export function resolveIdentity(input: IdentityInput): IdentitySignals {
  const parsed = parseMetadataUserId(input.metadataUserId);

  return {
    userHash: parsed.userHash,
    accountId: parsed.accountId,
    sessionId: parsed.sessionId,
    sessionHeaderId: input.sessionHeader,
    workspaceId: input.workspaceHeader,
    taskId: input.taskHeader,
    agentType: input.agentTypeHeader,
    proxyTokenIdentityId: input.proxyTokenIdentityId,
    userAgent: input.userAgent,
  };
}
