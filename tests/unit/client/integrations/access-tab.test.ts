import { describe, it, expect } from "bun:test";

/**
 * Tests for the Access tab: GrantTable and CreateGrantDialog view model functions.
 *
 * All tests exercise pure view-model derivation functions -- no DOM rendering.
 * The component is a thin renderer of these view models.
 *
 * Behaviors under test:
 *   1. Grant table: lists tools with expandable grant sections showing per-tool grants
 *   2. Grant row: shows identity name, source, rate limit, and date
 *   3. Create grant: validates identity selection (required)
 *   4. Duplicate grant: produces 'already has access' message
 *   5. Revoke confirmation: derives confirmation dialog view model
 *   6. Empty state: shows guidance when no tools have grants
 *   7. Grant count: successful grant increments tool grant_count display
 */

import type { ToolListItem } from "../../../../app/src/client/hooks/use-tools";
import type { GrantListItem } from "../../../../app/src/client/hooks/use-grants";

import {
  deriveGrantTableViewModel,
  deriveGrantRowViewModel,
  deriveRevokeConfirmationViewModel,
  deriveDuplicateGrantMessage,
  deriveUpdatedGrantCount,
  validateCreateGrantForm,
  type GrantTableInput,
  type CreateGrantFormData,
} from "../../../../app/src/client/components/tool-registry/GrantTable";

import {
  deriveCreateGrantDialogViewModel,
  type IdentityOption,
} from "../../../../app/src/client/components/tool-registry/CreateGrantDialog";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(overrides?: Partial<ToolListItem>): ToolListItem {
  return {
    id: "tool-1",
    name: "test-tool",
    toolkit: "default",
    description: "A test tool for testing",
    risk_level: "low",
    status: "active",
    grant_count: 0,
    governance_count: 0,
    provider_name: "manual",
    created_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeGrant(overrides?: Partial<GrantListItem>): GrantListItem {
  return {
    identity_id: "identity-1",
    identity_name: "Alice",
    tool_id: "tool-1",
    tool_name: "test-tool",
    granted_at: "2026-01-20T10:00:00Z",
    ...overrides,
  };
}

function makeIdentityOption(overrides?: Partial<IdentityOption>): IdentityOption {
  return {
    id: "identity-1",
    name: "Alice",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Grant table: tools with expandable grant sections
// ---------------------------------------------------------------------------

describe("GrantTable view model", () => {
  it("lists tools with grant counts", () => {
    const tools = [
      makeTool({ id: "t1", name: "read-file", grant_count: 3 }),
      makeTool({ id: "t2", name: "write-file", grant_count: 0 }),
    ];

    const vm = deriveGrantTableViewModel({ tools });

    expect(vm.rows).toHaveLength(2);
    expect(vm.rows[0].toolName).toBe("read-file");
    expect(vm.rows[0].grantCountDisplay).toBe("3");
    expect(vm.rows[1].toolName).toBe("write-file");
    expect(vm.rows[1].grantCountDisplay).toBe("0");
  });

  it("shows empty state when no tools exist", () => {
    const vm = deriveGrantTableViewModel({ tools: [] });

    expect(vm.showEmptyState).toBe(true);
    expect(vm.emptyStateMessage).toContain("grant");
  });

  it("does not show empty state when tools exist", () => {
    const vm = deriveGrantTableViewModel({ tools: [makeTool()] });

    expect(vm.showEmptyState).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grant row: identity name, rate limit, date
// ---------------------------------------------------------------------------

describe("deriveGrantRowViewModel", () => {
  it("shows identity name, rate limit, and formatted date", () => {
    const grant = makeGrant({
      identity_name: "Bob",
      max_calls_per_hour: 100,
      granted_at: "2026-02-10T14:30:00Z",
    });

    const row = deriveGrantRowViewModel(grant);

    expect(row.identityName).toBe("Bob");
    expect(row.rateLimitDisplay).toBe("100/hr");
    expect(row.grantedAtDisplay).toBe("2026-02-10T14:30:00Z");
  });

  it("shows 'Unlimited' when no rate limit set", () => {
    const grant = makeGrant({ max_calls_per_hour: undefined });

    const row = deriveGrantRowViewModel(grant);

    expect(row.rateLimitDisplay).toBe("Unlimited");
  });

  it("shows source as 'direct' for regular grants", () => {
    const grant = makeGrant();

    const row = deriveGrantRowViewModel(grant);

    expect(row.sourceDisplay).toBe("direct");
  });
});

// ---------------------------------------------------------------------------
// Create grant form validation
// ---------------------------------------------------------------------------

describe("validateCreateGrantForm", () => {
  it("requires identity_id to be selected", () => {
    const formData: CreateGrantFormData = {
      identity_id: "",
    };

    const result = validateCreateGrantForm(formData);

    expect(result.isValid).toBe(false);
    expect(result.errors.identity_id).toBeDefined();
  });

  it("passes validation with identity selected and no rate limit", () => {
    const formData: CreateGrantFormData = {
      identity_id: "identity-1",
    };

    const result = validateCreateGrantForm(formData);

    expect(result.isValid).toBe(true);
  });

  it("passes validation with identity and optional rate limit", () => {
    const formData: CreateGrantFormData = {
      identity_id: "identity-1",
      max_calls_per_hour: 50,
    };

    const result = validateCreateGrantForm(formData);

    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Duplicate grant message
// ---------------------------------------------------------------------------

describe("deriveDuplicateGrantMessage", () => {
  it("produces already-has-access message with identity and tool names", () => {
    const message = deriveDuplicateGrantMessage("Alice", "read-file");

    expect(message).toContain("already has access");
    expect(message).toContain("Alice");
    expect(message).toContain("read-file");
  });
});

// ---------------------------------------------------------------------------
// Revoke confirmation
// ---------------------------------------------------------------------------

describe("deriveRevokeConfirmationViewModel", () => {
  it("derives confirmation dialog with identity name", () => {
    const vm = deriveRevokeConfirmationViewModel("Alice", "read-file");

    expect(vm.title).toContain("Revoke");
    expect(vm.warning).toContain("Alice");
    expect(vm.warning).toContain("read-file");
    expect(vm.isDestructive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grant count update
// ---------------------------------------------------------------------------

describe("deriveUpdatedGrantCount", () => {
  it("increments grant count after successful grant", () => {
    const updated = deriveUpdatedGrantCount(2);

    expect(updated).toBe(3);
  });

  it("increments from zero", () => {
    const updated = deriveUpdatedGrantCount(0);

    expect(updated).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Create grant dialog view model
// ---------------------------------------------------------------------------

describe("deriveCreateGrantDialogViewModel", () => {
  it("derives identity options for dropdown", () => {
    const identities: IdentityOption[] = [
      makeIdentityOption({ id: "id-1", name: "Alice" }),
      makeIdentityOption({ id: "id-2", name: "Bob" }),
    ];

    const vm = deriveCreateGrantDialogViewModel({ identities, isLoading: false });

    expect(vm.identityOptions).toHaveLength(2);
    expect(vm.identityOptions[0].label).toBe("Alice");
    expect(vm.identityOptions[0].value).toBe("id-1");
  });

  it("shows loading state when identities are loading", () => {
    const vm = deriveCreateGrantDialogViewModel({ identities: [], isLoading: true });

    expect(vm.isLoadingIdentities).toBe(true);
    expect(vm.placeholderText).toContain("Loading");
  });

  it("shows placeholder when no identities available", () => {
    const vm = deriveCreateGrantDialogViewModel({ identities: [], isLoading: false });

    expect(vm.isLoadingIdentities).toBe(false);
    expect(vm.placeholderText).toContain("No identities");
  });
});
