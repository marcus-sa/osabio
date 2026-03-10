/**
 * RAR Operation Scope Verifier
 *
 * Matches a requested BrainAction against an array of authorized
 * BrainActions from a token's authorization_details claim.
 *
 * Pure function. No IO imports.
 */
import type { BrainAction, RARVerificationResult } from "./types";

function findMatchingAuthorization(
  requested: BrainAction,
  authorized: BrainAction[],
): BrainAction | undefined {
  return authorized.find(
    (auth) =>
      auth.type === requested.type &&
      auth.action === requested.action &&
      auth.resource === requested.resource,
  );
}

function findExceededConstraint(
  requestedConstraints: Record<string, unknown>,
  authorizedConstraints: Record<string, unknown>,
): string | undefined {
  return Object.keys(requestedConstraints).find((key) => {
    const requestedValue = requestedConstraints[key];
    const authorizedValue = authorizedConstraints[key];

    if (typeof requestedValue !== "number" || typeof authorizedValue !== "number") {
      return false;
    }

    return requestedValue > authorizedValue;
  });
}

export function verifyOperationScope(
  requested: BrainAction,
  authorized: BrainAction[],
): RARVerificationResult {
  const match = findMatchingAuthorization(requested, authorized);

  if (!match) {
    return {
      authorized: false,
      error: `No authorization for ${requested.action} on ${requested.resource}`,
      code: "authorization_details_mismatch",
    };
  }

  if (requested.constraints && match.constraints) {
    const exceeded = findExceededConstraint(requested.constraints, match.constraints);
    if (exceeded) {
      const requestedValue = requested.constraints[exceeded];
      const authorizedValue = match.constraints[exceeded];
      return {
        authorized: false,
        error: `Constraint ${exceeded} value ${requestedValue} exceeds authorized bound ${authorizedValue}`,
        code: "authorization_params_exceeded",
      };
    }
  }

  return { authorized: true };
}
