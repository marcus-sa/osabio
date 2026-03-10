/**
 * Unit tests for managed agent identity lifecycle.
 *
 * Tests pure identity revocation/status check functions:
 * - Active identity allowed
 * - Revoked identity blocked at intent submission
 * - Suspended identity blocked
 * - Managed agent blocked when managing human inactive
 * - Managed agent blocked when managing human not found
 * - Unmanaged identity skips manager check
 *
 * Acceptance criteria traced: M5-I1 through M5-I4
 * Step: 04-03
 */
import { describe, it, expect } from "bun:test";
import {
  checkIdentityStatus,
  checkManagerStatus,
  checkIdentityAllowed,
  type ResolvedIdentity,
  type ResolvedManager,
  type LookupIdentity,
  type LookupManager,
} from "../../../app/src/server/oauth/identity-lifecycle";

// ---------------------------------------------------------------------------
// Helpers -- pure function stubs (no mock libraries)
// ---------------------------------------------------------------------------

function activeHumanIdentity(id = "human-001"): ResolvedIdentity {
  return {
    identityId: id,
    identityType: "human",
    identityStatus: "active",
  };
}

function activeAgentIdentity(
  id = "agent-001",
  managedBy = "human-001",
): ResolvedIdentity {
  return {
    identityId: id,
    identityType: "agent",
    identityStatus: "active",
    managedBy,
  };
}

function revokedAgentIdentity(
  id = "agent-revoked",
  managedBy = "human-001",
): ResolvedIdentity {
  return {
    identityId: id,
    identityType: "agent",
    identityStatus: "revoked",
    managedBy,
    revokedAt: new Date(),
  };
}

function activeManager(id = "human-001"): ResolvedManager {
  return { identityId: id, identityStatus: "active" };
}

function inactiveManager(id = "human-inactive"): ResolvedManager {
  return { identityId: id, identityStatus: "revoked" };
}

/** Stub identity lookup returning a predefined map. */
function createIdentityLookupStub(
  identities: Record<string, ResolvedIdentity>,
): LookupIdentity {
  return async (id: string) => identities[id];
}

/** Stub manager lookup returning a predefined map. */
function createManagerLookupStub(
  managers: Record<string, ResolvedManager>,
): LookupManager {
  return async (id: string) => managers[id];
}

// ---------------------------------------------------------------------------
// checkIdentityStatus -- pure predicate
// ---------------------------------------------------------------------------

describe("checkIdentityStatus", () => {
  it("allows active identity", () => {
    const result = checkIdentityStatus(activeAgentIdentity());
    expect(result.allowed).toBe(true);
  });

  it("blocks revoked identity with identity_revoked code", () => {
    const result = checkIdentityStatus(revokedAgentIdentity());
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("identity_revoked");
      expect(result.reason).toContain("revoked");
    }
  });

  it("blocks suspended identity with identity_suspended code", () => {
    const suspended: ResolvedIdentity = {
      ...activeAgentIdentity(),
      identityStatus: "suspended",
    };
    const result = checkIdentityStatus(suspended);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("identity_suspended");
    }
  });

  it("allows active human identity", () => {
    const result = checkIdentityStatus(activeHumanIdentity());
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkManagerStatus -- pure predicate for managed agents
// ---------------------------------------------------------------------------

describe("checkManagerStatus", () => {
  it("allows managed agent when managing human is active", () => {
    const result = checkManagerStatus(
      activeAgentIdentity(),
      activeManager(),
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks managed agent when managing human is inactive", () => {
    const result = checkManagerStatus(
      activeAgentIdentity("agent-001", "human-inactive"),
      inactiveManager(),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("manager_inactive");
      expect(result.reason).toContain("inactive");
    }
  });

  it("blocks managed agent when managing human not found", () => {
    const result = checkManagerStatus(
      activeAgentIdentity(),
      undefined,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("manager_not_found");
    }
  });

  it("skips manager check for unmanaged identity", () => {
    const unmanaged: ResolvedIdentity = {
      identityId: "human-solo",
      identityType: "human",
      identityStatus: "active",
    };
    const result = checkManagerStatus(unmanaged, undefined);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkIdentityAllowed -- full pipeline with stubs
// ---------------------------------------------------------------------------

describe("checkIdentityAllowed", () => {
  it("allows active unmanaged identity", async () => {
    const lookupIdentity = createIdentityLookupStub({
      "human-001": activeHumanIdentity(),
    });
    const lookupManager = createManagerLookupStub({});

    const result = await checkIdentityAllowed(
      "human-001",
      lookupIdentity,
      lookupManager,
    );
    expect(result.allowed).toBe(true);
  });

  it("allows active managed agent with active manager", async () => {
    const lookupIdentity = createIdentityLookupStub({
      "agent-001": activeAgentIdentity("agent-001", "human-001"),
    });
    const lookupManager = createManagerLookupStub({
      "human-001": activeManager(),
    });

    const result = await checkIdentityAllowed(
      "agent-001",
      lookupIdentity,
      lookupManager,
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks revoked agent identity", async () => {
    const lookupIdentity = createIdentityLookupStub({
      "agent-revoked": revokedAgentIdentity(),
    });
    const lookupManager = createManagerLookupStub({
      "human-001": activeManager(),
    });

    const result = await checkIdentityAllowed(
      "agent-revoked",
      lookupIdentity,
      lookupManager,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("identity_revoked");
    }
  });

  it("blocks managed agent when managing human inactive", async () => {
    const lookupIdentity = createIdentityLookupStub({
      "agent-orphan": activeAgentIdentity("agent-orphan", "human-inactive"),
    });
    const lookupManager = createManagerLookupStub({
      "human-inactive": inactiveManager(),
    });

    const result = await checkIdentityAllowed(
      "agent-orphan",
      lookupIdentity,
      lookupManager,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("manager_inactive");
    }
  });

  it("returns identity_not_found for unknown identity", async () => {
    const lookupIdentity = createIdentityLookupStub({});
    const lookupManager = createManagerLookupStub({});

    const result = await checkIdentityAllowed(
      "unknown-id",
      lookupIdentity,
      lookupManager,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("identity_not_found");
    }
  });

  it("blocks managed agent when manager record missing", async () => {
    const lookupIdentity = createIdentityLookupStub({
      "agent-missing-mgr": activeAgentIdentity("agent-missing-mgr", "ghost-human"),
    });
    const lookupManager = createManagerLookupStub({});

    const result = await checkIdentityAllowed(
      "agent-missing-mgr",
      lookupIdentity,
      lookupManager,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("manager_not_found");
    }
  });
});
