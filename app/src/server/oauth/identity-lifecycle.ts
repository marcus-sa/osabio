/**
 * Managed Agent Identity Lifecycle
 *
 * Pure functions for identity revocation checks.
 * Used at intent submission (reject new intents from revoked agents)
 * and DPoP verification (reject tokens for revoked agents).
 *
 * Pure domain logic -- no IO imports.
 *
 * Step: 04-03
 */

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/** Identity status discriminated union. */
export type IdentityStatus = "active" | "revoked" | "suspended";

/** Resolved identity data needed for lifecycle checks. */
export type ResolvedIdentity = {
  identityId: string;
  identityType: "human" | "agent" | "system";
  identityStatus: IdentityStatus;
  managedBy?: string;
  revokedAt?: Date;
};

/** Resolved managing human data (when identity is managed). */
export type ResolvedManager = {
  identityId: string;
  identityStatus: IdentityStatus;
};

/** Identity check result -- discriminated union. */
export type IdentityCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: IdentityErrorCode };

export type IdentityErrorCode =
  | "identity_revoked"
  | "identity_suspended"
  | "manager_inactive"
  | "identity_not_found"
  | "manager_not_found";

// ---------------------------------------------------------------------------
// Port: Identity Lookup (function signature, no IO)
// ---------------------------------------------------------------------------

export type LookupIdentity = (
  identityId: string,
) => Promise<ResolvedIdentity | undefined>;

export type LookupManager = (
  managerId: string,
) => Promise<ResolvedManager | undefined>;

// ---------------------------------------------------------------------------
// Pure Validation Functions
// ---------------------------------------------------------------------------

/** Check if an identity's own status allows operations. */
export function checkIdentityStatus(
  identity: ResolvedIdentity,
): IdentityCheckResult {
  if (identity.identityStatus === "revoked") {
    return {
      allowed: false,
      reason: "Identity has been revoked",
      code: "identity_revoked",
    };
  }

  if (identity.identityStatus === "suspended") {
    return {
      allowed: false,
      reason: "Identity is suspended",
      code: "identity_suspended",
    };
  }

  return { allowed: true };
}

/** Check if a managed agent's managing human is active. */
export function checkManagerStatus(
  identity: ResolvedIdentity,
  manager: ResolvedManager | undefined,
): IdentityCheckResult {
  // Only applies to managed agents
  if (!identity.managedBy) {
    return { allowed: true };
  }

  if (!manager) {
    return {
      allowed: false,
      reason: "Managing human identity not found",
      code: "manager_not_found",
    };
  }

  if (manager.identityStatus !== "active") {
    return {
      allowed: false,
      reason: "Managing human is inactive",
      code: "manager_inactive",
    };
  }

  return { allowed: true };
}

/**
 * Full identity lifecycle check pipeline.
 *
 * Checks:
 * 1. Identity exists
 * 2. Identity status is active (not revoked/suspended)
 * 3. If managed agent, managing human is also active
 */
export async function checkIdentityAllowed(
  identityId: string,
  lookupIdentity: LookupIdentity,
  lookupManager: LookupManager,
): Promise<IdentityCheckResult> {
  const identity = await lookupIdentity(identityId);
  if (!identity) {
    return {
      allowed: false,
      reason: "Identity not found",
      code: "identity_not_found",
    };
  }

  const statusCheck = checkIdentityStatus(identity);
  if (!statusCheck.allowed) {
    return statusCheck;
  }

  const managerCheck = checkManagerStatus(
    identity,
    identity.managedBy ? await lookupManager(identity.managedBy) : undefined,
  );
  if (!managerCheck.allowed) {
    return managerCheck;
  }

  return { allowed: true };
}
