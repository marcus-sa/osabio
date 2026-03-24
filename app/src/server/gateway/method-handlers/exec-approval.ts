/**
 * Exec approval handlers — exec.approve and exec.deny.
 *
 * The exec approval store is a simple in-memory Map of requestId to a resolve
 * callback. When the mock agent (or real orchestrator) emits an exec_request
 * event, it registers a pending request in the store. The client approves or
 * denies via exec.approve / exec.deny, which resolves the pending promise.
 *
 * Pure handler factories — no IO imports. The store is injected as a dependency.
 */
import type { MethodHandler } from "../method-dispatch";

// ---------------------------------------------------------------------------
// ExecApprovalStore — shared between agent and approval handlers
// ---------------------------------------------------------------------------

export type ExecDecision = "approved" | "denied";

export type ExecApprovalStore = {
  /** Register a pending exec request. Returns a promise that resolves with the decision. */
  readonly register: (requestId: string) => Promise<ExecDecision>;
  /** Resolve a pending exec request with a decision. Returns false if requestId not found. */
  readonly resolve: (requestId: string, decision: ExecDecision) => boolean;
};

export function createExecApprovalStore(): ExecApprovalStore {
  const pending = new Map<string, (decision: ExecDecision) => void>();

  return {
    register(requestId: string): Promise<ExecDecision> {
      return new Promise<ExecDecision>((resolvePromise) => {
        pending.set(requestId, resolvePromise);
      });
    },

    resolve(requestId: string, decision: ExecDecision): boolean {
      const resolveCallback = pending.get(requestId);
      if (!resolveCallback) return false;
      pending.delete(requestId);
      resolveCallback(decision);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Approval params shape
// ---------------------------------------------------------------------------

type ExecApprovalParams = {
  readonly requestId?: string;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function createExecApproveHandler(store: ExecApprovalStore): MethodHandler {
  return async (_connection, params, _deps) => {
    const approvalParams = (params ?? {}) as ExecApprovalParams;

    if (!approvalParams.requestId) {
      return {
        ok: false,
        error: {
          code: "invalid_frame",
          message: "exec.approve requires a 'requestId' parameter",
        },
      };
    }

    const resolved = store.resolve(approvalParams.requestId, "approved");
    if (!resolved) {
      return {
        ok: false,
        error: {
          code: "session_not_found",
          message: `No pending exec request found for requestId: ${approvalParams.requestId}`,
        },
      };
    }

    return {
      ok: true,
      payload: { requestId: approvalParams.requestId, decision: "approved" },
    };
  };
}

export function createExecDenyHandler(store: ExecApprovalStore): MethodHandler {
  return async (_connection, params, _deps) => {
    const denyParams = (params ?? {}) as ExecApprovalParams;

    if (!denyParams.requestId) {
      return {
        ok: false,
        error: {
          code: "invalid_frame",
          message: "exec.deny requires a 'requestId' parameter",
        },
      };
    }

    const resolved = store.resolve(denyParams.requestId, "denied");
    if (!resolved) {
      return {
        ok: false,
        error: {
          code: "session_not_found",
          message: `No pending exec request found for requestId: ${denyParams.requestId}`,
        },
      };
    }

    return {
      ok: true,
      payload: { requestId: denyParams.requestId, decision: "denied" },
    };
  };
}
