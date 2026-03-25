/**
 * Error Response Builder — Pure functions for building structured
 * MCP error responses and enriching gated tool descriptions.
 *
 * Pure core: no IO, no DB, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionSpecTemplate = {
  readonly provider: string;
  readonly action: string;
  readonly parameterSchema?: Record<string, unknown>;
};

export type IntentRequiredError = {
  readonly code: -32403;
  readonly message: "intent_required";
  readonly data: {
    readonly tool: string;
    readonly action_spec_template: ActionSpecTemplate;
  };
};

export type ConstraintViolationError = {
  readonly code: -32403;
  readonly message: "constraint_violation";
  readonly data: {
    readonly field: string;
    readonly requested: unknown;
    readonly authorized: unknown;
  };
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Build an intent-required error response for a gated tool invocation. */
export function buildIntentRequiredError(
  toolName: string,
  toolkit: string,
  parameterSchema?: Record<string, unknown>,
): IntentRequiredError {
  const actionSpecTemplate: ActionSpecTemplate = {
    provider: toolkit,
    action: toolName,
    ...(parameterSchema ? { parameterSchema } : {}),
  };

  return {
    code: -32403,
    message: "intent_required",
    data: {
      tool: toolName,
      action_spec_template: actionSpecTemplate,
    },
  };
}

/** Build a constraint-violation error response. */
export function buildConstraintViolationError(
  field: string,
  requested: unknown,
  authorized: unknown,
): ConstraintViolationError {
  return {
    code: -32403,
    message: "constraint_violation",
    data: { field, requested, authorized },
  };
}

/** Prepend escalation instructions to a gated tool's description. */
export function enrichGatedDescription(
  originalDescription: string,
  toolkit: string,
  action: string,
): string {
  return (
    `[GATED] This tool requires an approved intent for ${toolkit}:${action}. ` +
    `Request an intent before calling this tool.\n\n${originalDescription}`
  );
}
