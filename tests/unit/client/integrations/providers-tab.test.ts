import { describe, it, expect } from "bun:test";

/**
 * Tests for the Providers tab: ProviderTable view model and CreateProviderDialog
 * form logic.
 *
 * All tests exercise pure view-model derivation functions -- no DOM rendering.
 * The components are thin renderers of these view models.
 *
 * Behaviors under test:
 *   1. Provider table: renders row view models from provider data
 *   2. Auth method badge: maps auth_method to display variant
 *   3. Create dialog: adapts visible fields based on auth_method selection
 *   4. Create dialog: validates required fields
 *   5. Create dialog: preserves form data on failure
 *   6. Delete confirmation: warns about active accounts
 *   7. Empty state: shows guidance when no providers exist
 */

import type { ProviderListItem } from "../../../../app/src/client/hooks/use-providers";

import {
  deriveProviderTableViewModel,
  deriveAuthMethodBadge,
  deriveCreateProviderFormFields,
  validateCreateProviderForm,
  deriveDeleteConfirmationViewModel,
  type ProviderTableInput,
  type CreateProviderFormData,
  type AuthMethod,
} from "../../../../app/src/client/components/tool-registry/ProviderTable";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProvider(overrides?: Partial<ProviderListItem>): ProviderListItem {
  return {
    id: "prov-1",
    name: "test-provider",
    display_name: "Test Provider",
    auth_method: "oauth2",
    has_client_secret: true,
    created_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeTableInput(overrides?: Partial<ProviderTableInput>): ProviderTableInput {
  return {
    providers: [],
    ...overrides,
  };
}

function makeFormData(overrides?: Partial<CreateProviderFormData>): CreateProviderFormData {
  return {
    name: "",
    display_name: "",
    auth_method: "oauth2" as AuthMethod,
    authorization_url: "",
    token_url: "",
    client_id: "",
    client_secret: "",
    scopes: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provider table view model
// ---------------------------------------------------------------------------

describe("ProviderTable view model", () => {
  describe("renders providers with correct badges", () => {
    it("maps each provider to a row with auth method badge info", () => {
      const providers = [
        makeProvider({ id: "1", name: "github", auth_method: "oauth2" }),
        makeProvider({ id: "2", name: "openai", auth_method: "api_key" }),
      ];

      const vm = deriveProviderTableViewModel(makeTableInput({ providers }));

      expect(vm.rows).toHaveLength(2);
      expect(vm.rows[0].name).toBe("github");
      expect(vm.rows[0].authMethodBadge.label).toBe("OAuth2");
      expect(vm.rows[1].name).toBe("openai");
      expect(vm.rows[1].authMethodBadge.label).toBe("API Key");
    });

    it("shows empty state when no providers exist", () => {
      const vm = deriveProviderTableViewModel(makeTableInput({ providers: [] }));

      expect(vm.showEmptyState).toBe(true);
      expect(vm.emptyStateMessage).toBe("No credential providers configured. Add a provider to connect external services.");
    });

    it("does not show empty state when providers exist", () => {
      const vm = deriveProviderTableViewModel(
        makeTableInput({ providers: [makeProvider()] }),
      );

      expect(vm.showEmptyState).toBe(false);
    });

    it("includes has_client_secret indicator in row", () => {
      const withSecret = makeProvider({ has_client_secret: true });
      const withoutSecret = makeProvider({ id: "2", has_client_secret: false });

      const vm = deriveProviderTableViewModel(
        makeTableInput({ providers: [withSecret, withoutSecret] }),
      );

      expect(vm.rows[0].hasClientSecret).toBe(true);
      expect(vm.rows[1].hasClientSecret).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Auth method badge derivation
// ---------------------------------------------------------------------------

describe("deriveAuthMethodBadge", () => {
  it("returns OAuth2 label and default variant for oauth2", () => {
    const badge = deriveAuthMethodBadge("oauth2");

    expect(badge.label).toBe("OAuth2");
    expect(badge.variant).toBe("default");
  });

  it("returns API Key label and secondary variant for api_key", () => {
    const badge = deriveAuthMethodBadge("api_key");

    expect(badge.label).toBe("API Key");
    expect(badge.variant).toBe("secondary");
  });

  it("returns the raw value as label for unknown auth methods", () => {
    const badge = deriveAuthMethodBadge("custom_auth");

    expect(badge.label).toBe("custom_auth");
    expect(badge.variant).toBe("outline");
  });
});

// ---------------------------------------------------------------------------
// Create provider dialog: adaptive form fields
// ---------------------------------------------------------------------------

describe("CreateProviderDialog form logic", () => {
  describe("shows adaptive form fields when auth_method changes", () => {
    it("shows 6 additional fields when auth_method is oauth2", () => {
      const fields = deriveCreateProviderFormFields("oauth2");

      expect(fields).toContain("authorization_url");
      expect(fields).toContain("token_url");
      expect(fields).toContain("client_id");
      expect(fields).toContain("client_secret");
      expect(fields).toContain("scopes");
      expect(fields).toContain("name");
      expect(fields).toContain("display_name");
      expect(fields).toHaveLength(7);
    });

    it("shows only name and display_name when auth_method is api_key", () => {
      const fields = deriveCreateProviderFormFields("api_key");

      expect(fields).toContain("name");
      expect(fields).toContain("display_name");
      expect(fields).toHaveLength(2);
    });
  });

  describe("validates required fields", () => {
    it("returns errors for empty required fields with oauth2", () => {
      const formData = makeFormData({ auth_method: "oauth2" });

      const result = validateCreateProviderForm(formData);

      expect(result.isValid).toBe(false);
      expect(result.errors.name).toBeDefined();
      expect(result.errors.authorization_url).toBeDefined();
      expect(result.errors.token_url).toBeDefined();
      expect(result.errors.client_id).toBeDefined();
    });

    it("returns errors for empty required fields with api_key", () => {
      const formData = makeFormData({ auth_method: "api_key" });

      const result = validateCreateProviderForm(formData);

      expect(result.isValid).toBe(false);
      expect(result.errors.name).toBeDefined();
    });

    it("passes validation when all required oauth2 fields are filled", () => {
      const formData = makeFormData({
        auth_method: "oauth2",
        name: "github",
        display_name: "GitHub",
        authorization_url: "https://github.com/login/oauth/authorize",
        token_url: "https://github.com/login/oauth/access_token",
        client_id: "abc123",
        client_secret: "secret456",
        scopes: "repo,user",
      });

      const result = validateCreateProviderForm(formData);

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it("passes validation when all required api_key fields are filled", () => {
      const formData = makeFormData({
        auth_method: "api_key",
        name: "openai",
        display_name: "OpenAI",
      });

      const result = validateCreateProviderForm(formData);

      expect(result.isValid).toBe(true);
    });

    it("does not validate oauth2-specific fields when auth_method is api_key", () => {
      const formData = makeFormData({
        auth_method: "api_key",
        name: "openai",
        display_name: "OpenAI",
        authorization_url: "", // empty but should not cause error
      });

      const result = validateCreateProviderForm(formData);

      expect(result.isValid).toBe(true);
      expect(result.errors.authorization_url).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Delete confirmation view model
// ---------------------------------------------------------------------------

describe("deriveDeleteConfirmationViewModel", () => {
  it("warns about consequences when deleting a provider", () => {
    const vm = deriveDeleteConfirmationViewModel("GitHub", 3);

    expect(vm.title).toBe("Delete GitHub?");
    expect(vm.warning).toContain("3 account");
    expect(vm.isDestructive).toBe(true);
  });

  it("shows no account warning when provider has zero accounts", () => {
    const vm = deriveDeleteConfirmationViewModel("OpenAI", 0);

    expect(vm.title).toBe("Delete OpenAI?");
    expect(vm.warning).not.toContain("account");
    expect(vm.isDestructive).toBe(true);
  });

  it("uses singular for one account", () => {
    const vm = deriveDeleteConfirmationViewModel("Slack", 1);

    expect(vm.warning).toContain("1 account");
    expect(vm.warning).not.toContain("accounts");
  });
});
