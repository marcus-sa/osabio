import { describe, it, expect } from "bun:test";

/**
 * Tests for ToolRegistryPage view-model logic.
 *
 * The ToolRegistryPage is a route component at /tools.
 * We test the pure view-model derivation that the page uses
 * to map tab state and data to rendering decisions.
 *
 * Behaviors under test:
 *   1. Default tab: defaults to "tools" when no tab param provided
 *   2. Tab selection: all four tabs are valid and selectable
 *   3. Invalid tab param: falls back to "tools" for unknown values
 *   4. Empty state: shows empty state with CTA when data array is empty
 *   5. Tab persistence: selected tab is reflected in view model
 */

import {
  deriveToolRegistryViewModel,
  TOOL_REGISTRY_TABS,
  type ToolRegistryPageInput,
} from "../../../../app/src/client/routes/tool-registry-page";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<ToolRegistryPageInput>): ToolRegistryPageInput {
  return {
    tabParam: undefined,
    toolsCount: 0,
    providersCount: 0,
    accountsCount: 0,
    mcpServersCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tab navigation view model
// ---------------------------------------------------------------------------

describe("ToolRegistryPage view model", () => {
  describe("renders five tabs and defaults to Tools tab", () => {
    it("exposes exactly five tab definitions", () => {
      expect(TOOL_REGISTRY_TABS).toHaveLength(5);
      const tabIds = TOOL_REGISTRY_TABS.map((t) => t.id);
      expect(tabIds).toEqual(["servers", "tools", "access", "providers", "accounts"]);
    });

    it("defaults to tools tab when no tab param is provided", () => {
      const vm = deriveToolRegistryViewModel(makeInput());

      expect(vm.activeTab).toBe("tools");
    });

    it("defaults to tools tab when tab param is undefined", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: undefined }));

      expect(vm.activeTab).toBe("tools");
    });
  });

  describe("tab selection", () => {
    it("selects providers tab when param is 'providers'", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "providers" }));

      expect(vm.activeTab).toBe("providers");
    });

    it("selects accounts tab when param is 'accounts'", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "accounts" }));

      expect(vm.activeTab).toBe("accounts");
    });

    it("selects access tab when param is 'access'", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "access" }));

      expect(vm.activeTab).toBe("access");
    });

    it("falls back to tools tab for invalid tab param", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "nonexistent" }));

      expect(vm.activeTab).toBe("tools");
    });
  });

  describe("empty state", () => {
    it("shows empty state when tools count is zero on tools tab", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "tools", toolsCount: 0 }));

      expect(vm.showEmptyState).toBe(true);
    });

    it("shows empty state when providers count is zero on providers tab", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "providers", providersCount: 0 }));

      expect(vm.showEmptyState).toBe(true);
    });

    it("does not show empty state when data exists for active tab", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "tools", toolsCount: 3 }));

      expect(vm.showEmptyState).toBe(false);
    });

    it("shows empty state when accounts count is zero on accounts tab", () => {
      const vm = deriveToolRegistryViewModel(makeInput({ tabParam: "accounts", accountsCount: 0 }));

      expect(vm.showEmptyState).toBe(true);
    });
  });

  describe("tab labels include item counts", () => {
    it("includes counts in tab labels when data exists", () => {
      const vm = deriveToolRegistryViewModel(
        makeInput({ toolsCount: 5, providersCount: 2, accountsCount: 1, mcpServersCount: 3 }),
      );

      expect(vm.tabLabels).toEqual({
        servers: "Servers (3)",
        tools: "Tools (5)",
        providers: "Providers (2)",
        accounts: "Accounts (1)",
        access: "Access (5)",
      });
    });

    it("omits counts when zero", () => {
      const vm = deriveToolRegistryViewModel(makeInput());

      expect(vm.tabLabels).toEqual({
        servers: "Servers",
        tools: "Tools",
        providers: "Providers",
        accounts: "Accounts",
        access: "Access",
      });
    });
  });
});
