/**
 * Gateway shared types — dependency port, connection state, and shared abstractions.
 *
 * GatewayDeps is the port type: all external capabilities the gateway needs
 * are expressed as function signatures, not module imports.
 */
import type { Surreal } from "surrealdb";
import type { ServerConfig } from "../runtime/config";
import type { SseRegistry } from "../streaming/sse-registry";
import type { StreamEvent } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Connection state machine — pure states, no mutable fields
// ---------------------------------------------------------------------------

export type ConnectionState = "connecting" | "authenticating" | "active" | "closed";

// ---------------------------------------------------------------------------
// PendingChallenge — nonce + timestamp for connect.challenge
// ---------------------------------------------------------------------------

export type PendingChallenge = {
  readonly nonce: string;
  readonly ts: number;
};

// ---------------------------------------------------------------------------
// GatewayConnection — per-connection context
// ---------------------------------------------------------------------------

export type GatewayConnection = {
  readonly connectionId: string;
  readonly state: ConnectionState;
  readonly createdAt: number;
  // Set during authentication
  readonly deviceFingerprint?: string;
  readonly challenge?: PendingChallenge;
  // Set after authentication
  readonly identityId?: string;
  readonly workspaceId?: string;
  readonly agentId?: string;
  // Runtime state
  readonly seqCounter: number;
  readonly activeSessions: ReadonlySet<string>;
};

// Re-export StreamEvent from shared contracts
export type { StreamEvent } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// GatewayDeps — the port type for all gateway dependencies
//
// Every external capability is a function signature. The gateway never
// imports IO modules directly. Dependencies are injected at the composition root.
// ---------------------------------------------------------------------------

export type GatewayDeps = {
  // From ServerDependencies
  readonly surreal: Surreal;
  readonly config: ServerConfig;
  readonly sseRegistry: SseRegistry;

  // Ports to Brain systems (function signatures, not module imports)
  readonly assignTask: AssignTaskFn;
  readonly evaluateIntent: EvaluateIntentFn;
  readonly loadContext: LoadContextFn;
  readonly lookupIdentity: LookupIdentityFn;
  readonly lookupWorkspace: LookupWorkspaceFn;
  readonly recordTrace: RecordTraceFn;

  // Session management (sessions.* methods)
  readonly listSessions: ListSessionsFn;
  readonly getSessionHistory: GetSessionHistoryFn;
  readonly patchSession: PatchSessionFn;

  // Tool registry (tools.catalog — scoped to agent's granted tools)
  readonly listGrantedTools: ListGrantedToolsFn;

  // Event subscription (async iterator over orchestrator events)
  readonly subscribeToSessionEvents: (sessionId: string) => AsyncIterable<StreamEvent>;
};

// ---------------------------------------------------------------------------
// Port function signatures
// ---------------------------------------------------------------------------

export type AssignTaskFn = (
  workspaceId: string,
  identityId: string,
  task: string,
  agentConfig?: { model?: string; maxTokens?: number },
) => Promise<{ runId: string; sessionId: string }>;

export type EvaluateIntentResult = {
  readonly authorized: boolean;
  readonly reason?: string;
  readonly policy_result?: string;
  readonly budget_result?: string;
};

export type EvaluateIntentFn = (
  workspaceId: string,
  identityId: string,
  action: string,
) => Promise<EvaluateIntentResult>;

export type LoadContextFn = (
  workspaceId: string,
  taskDescription: string,
) => Promise<{
  decisions: number;
  constraints: number;
  learnings: number;
  observations: number;
}>;

export type LookupIdentityFn = (
  fingerprint: string,
) => Promise<{ identityId: string; workspaceId: string; agentId: string } | undefined>;

export type LookupWorkspaceFn = (
  identityId: string,
) => Promise<{ id: string; name: string } | undefined>;

export type RecordTraceFn = (trace: {
  connectionId: string;
  method: string;
  durationMs: number;
  error?: string;
}) => Promise<void>;

export type ListSessionsFn = (
  workspaceId: string,
  identityId: string,
  status?: "active" | "completed" | "all",
  limit?: number,
) => Promise<ReadonlyArray<SessionSummary>>;

export type GetSessionHistoryFn = (
  runId: string,
) => Promise<{ runId: string; trace: ReadonlyArray<TraceNode> }>;

export type PatchSessionFn = (
  runId: string,
  patch: { model?: string; thinkingLevel?: string; verbose?: boolean },
) => Promise<{ runId: string; applied: string[] }>;

export type ListGrantedToolsFn = (
  workspaceId: string,
  identityId: string,
) => Promise<ReadonlyArray<{ name: string; description: string; server: string }>>;

// ---------------------------------------------------------------------------
// Session & trace types used by port signatures
// ---------------------------------------------------------------------------

export type SessionSummary = {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly task: string;
  readonly startedAt: string;
  readonly lastEventAt?: string;
  readonly endedAt?: string;
  readonly toolCalls?: number;
};

export type TraceNode = {
  readonly id: string;
  readonly type: string;
  readonly toolName?: string;
  readonly durationMs?: number;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly children: ReadonlyArray<TraceNode>;
  readonly createdAt: string;
};
