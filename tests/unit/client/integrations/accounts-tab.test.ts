import { describe, it, expect } from "bun:test";

/**
 * Tests for the Accounts tab: AccountTable view model and ConnectAccountDialog
 * form logic.
 *
 * All tests exercise pure view-model derivation functions -- no DOM rendering.
 * The components are thin renderers of these view models.
 *
 * Behaviors under test:
 *   1. Account table: renders status badges and correct actions per account state
 *   2. Account table: shows empty state with guidance to Providers tab
 *   3. Connect dialog: shows correct fields per provider auth_method
 *   4. Connect dialog: validates non-empty credentials before submit
 *   5. Connect dialog: OAuth2 shows provider name, scopes, and confirmation
 *   6. Revoke confirmation: warns about permanent credential deletion
 *   7. Reconnect: opens appropriate form based on auth_method
 */

import type { AccountListItem } from "../../../../app/src/client/hooks/use-accounts";

import {
  deriveAccountTableViewModel,
  deriveStatusBadge,
  deriveAccountAction,
  deriveConnectFormFields,
  validateConnectForm,
  deriveRevokeConfirmationViewModel,
  deriveOAuth2ConnectViewModel,
  type AccountTableInput,
  type ConnectFormData,
} from "../../../../app/src/client/components/tool-registry/AccountTable";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAccount(overrides?: Partial<AccountListItem>): AccountListItem {
  return {
    id: "acct-1",
    provider_id: "prov-1",
    status: "active",
    has_api_key: false,
    has_bearer_token: false,
    has_basic_credentials: false,
    has_access_token: false,
    connected_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeTableInput(overrides?: Partial<AccountTableInput>): AccountTableInput {
  return {
    accounts: [],
    providers: [],
    ...overrides,
  };
}

function makeConnectFormData(overrides?: Partial<ConnectFormData>): ConnectFormData {
  return {
    authMethod: "api_key",
    apiKey: "",
    bearerToken: "",
    username: "",
    password: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Account table view model: renders status badges and correct actions
// ---------------------------------------------------------------------------

describe("AccountTable view model", () => {
  describe("renders status badges and correct actions per account state", () => {
    it("maps each account to a row with provider display name and status badge", () => {
      const accounts = [
        makeAccount({ id: "1", status: "active", provider_id: "prov-gh" }),
        makeAccount({ id: "2", status: "revoked", provider_id: "prov-gh" }),
        makeAccount({ id: "3", status: "expired", provider_id: "prov-gh" }),
      ];
      const providers = [{ id: "prov-gh", displayName: "GitHub", authMethod: "api_key" }];

      const vm = deriveAccountTableViewModel(makeTableInput({ accounts, providers }));

      expect(vm.rows).toHaveLength(3);
      expect(vm.rows[0].providerDisplayName).toBe("GitHub");
      expect(vm.rows[0].statusBadge.label).toBe("Active");
      expect(vm.rows[0].statusBadge.variant).toBe("default");

      expect(vm.rows[1].statusBadge.label).toBe("Revoked");
      expect(vm.rows[1].statusBadge.variant).toBe("destructive");

      expect(vm.rows[2].statusBadge.label).toBe("Expired");
      expect(vm.rows[2].statusBadge.variant).toBe("secondary");
    });

    it("shows Revoke action for active accounts", () => {
      const action = deriveAccountAction("active");
      expect(action.label).toBe("Revoke");
      expect(action.kind).toBe("revoke");
    });

    it("shows Reconnect action for revoked accounts", () => {
      const action = deriveAccountAction("revoked");
      expect(action.label).toBe("Reconnect");
      expect(action.kind).toBe("reconnect");
    });

    it("shows Reconnect action for expired accounts", () => {
      const action = deriveAccountAction("expired");
      expect(action.label).toBe("Reconnect");
      expect(action.kind).toBe("reconnect");
    });

    it("includes connected_at date in row", () => {
      const account = makeAccount({ connected_at: "2026-03-20T14:00:00Z" });
      const providers = [{ id: "prov-1", displayName: "Test", authMethod: "api_key" }];

      const vm = deriveAccountTableViewModel(
        makeTableInput({ accounts: [account], providers }),
      );

      expect(vm.rows[0].connectedAt).toBe("2026-03-20T14:00:00Z");
    });
  });

  describe("shows empty state with guidance to Providers tab", () => {
    it("shows empty state when no accounts exist", () => {
      const vm = deriveAccountTableViewModel(makeTableInput({ accounts: [], providers: [] }));

      expect(vm.showEmptyState).toBe(true);
      expect(vm.emptyStateMessage).toContain("No connected accounts");
    });

    it("empty state mentions Providers tab", () => {
      const vm = deriveAccountTableViewModel(makeTableInput({ accounts: [], providers: [] }));

      expect(vm.emptyStateMessage).toContain("Providers");
    });

    it("does not show empty state when accounts exist", () => {
      const providers = [{ id: "prov-1", displayName: "Test", authMethod: "api_key" }];
      const vm = deriveAccountTableViewModel(
        makeTableInput({ accounts: [makeAccount()], providers }),
      );

      expect(vm.showEmptyState).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Status badge derivation
// ---------------------------------------------------------------------------

describe("deriveStatusBadge", () => {
  it("returns Active label and default variant for active status", () => {
    const badge = deriveStatusBadge("active");
    expect(badge.label).toBe("Active");
    expect(badge.variant).toBe("default");
  });

  it("returns Revoked label and destructive variant for revoked status", () => {
    const badge = deriveStatusBadge("revoked");
    expect(badge.label).toBe("Revoked");
    expect(badge.variant).toBe("destructive");
  });

  it("returns Expired label and secondary variant for expired status", () => {
    const badge = deriveStatusBadge("expired");
    expect(badge.label).toBe("Expired");
    expect(badge.variant).toBe("secondary");
  });

  it("returns raw value with outline variant for unknown status", () => {
    const badge = deriveStatusBadge("unknown_status");
    expect(badge.label).toBe("unknown_status");
    expect(badge.variant).toBe("outline");
  });
});

// ---------------------------------------------------------------------------
// Connect dialog: adaptive fields per auth_method
// ---------------------------------------------------------------------------

describe("ConnectAccountDialog form logic", () => {
  describe("shows correct fields per provider auth_method", () => {
    it("shows single masked api_key field for api_key auth method", () => {
      const fields = deriveConnectFormFields("api_key");
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "apiKey", inputType: "password" }),
      );
      expect(fields).toHaveLength(1);
    });

    it("shows single masked bearer token field for bearer auth method", () => {
      const fields = deriveConnectFormFields("bearer");
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "bearerToken", inputType: "password" }),
      );
      expect(fields).toHaveLength(1);
    });

    it("shows username and password fields for basic auth method", () => {
      const fields = deriveConnectFormFields("basic");
      expect(fields).toHaveLength(2);
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "username", inputType: "text" }),
      );
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "password", inputType: "password" }),
      );
    });

    it("returns empty fields for oauth2 (handled by redirect flow)", () => {
      const fields = deriveConnectFormFields("oauth2");
      expect(fields).toHaveLength(0);
    });
  });

  describe("validates non-empty credentials before submit", () => {
    it("rejects empty api_key submission", () => {
      const result = validateConnectForm(
        makeConnectFormData({ authMethod: "api_key", apiKey: "" }),
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.apiKey).toBeDefined();
    });

    it("accepts non-empty api_key submission", () => {
      const result = validateConnectForm(
        makeConnectFormData({ authMethod: "api_key", apiKey: "sk-abc123" }),
      );

      expect(result.isValid).toBe(true);
    });

    it("rejects empty bearer token submission", () => {
      const result = validateConnectForm(
        makeConnectFormData({ authMethod: "bearer", bearerToken: "" }),
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.bearerToken).toBeDefined();
    });

    it("rejects empty username or password for basic auth", () => {
      const result = validateConnectForm(
        makeConnectFormData({ authMethod: "basic", username: "", password: "" }),
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.username).toBeDefined();
      expect(result.errors.password).toBeDefined();
    });

    it("accepts filled basic auth credentials", () => {
      const result = validateConnectForm(
        makeConnectFormData({ authMethod: "basic", username: "user", password: "pass" }),
      );

      expect(result.isValid).toBe(true);
    });

    it("oauth2 always passes validation (redirect-based)", () => {
      const result = validateConnectForm(
        makeConnectFormData({ authMethod: "oauth2" }),
      );

      expect(result.isValid).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// OAuth2 connect view model
// ---------------------------------------------------------------------------

describe("deriveOAuth2ConnectViewModel", () => {
  it("shows provider name, scopes, and continue button text", () => {
    const vm = deriveOAuth2ConnectViewModel("GitHub", "repo,user");

    expect(vm.providerName).toBe("GitHub");
    expect(vm.scopes).toEqual(["repo", "user"]);
    expect(vm.continueButtonText).toBe("Continue to GitHub");
    expect(vm.securityExplanation).toBeDefined();
    expect(vm.securityExplanation.length).toBeGreaterThan(0);
  });

  it("handles empty scopes string", () => {
    const vm = deriveOAuth2ConnectViewModel("Slack", "");

    expect(vm.scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Revoke confirmation view model
// ---------------------------------------------------------------------------

describe("deriveRevokeConfirmationViewModel", () => {
  it("warns about permanent credential deletion", () => {
    const vm = deriveRevokeConfirmationViewModel("GitHub");

    expect(vm.title).toContain("Revoke");
    expect(vm.title).toContain("GitHub");
    expect(vm.warning).toContain("permanent");
    expect(vm.isDestructive).toBe(true);
  });
});
