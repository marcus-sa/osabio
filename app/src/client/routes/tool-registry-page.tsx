import { useCallback, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { ProviderTable } from "../components/tool-registry/ProviderTable";
import { CreateProviderDialog } from "../components/tool-registry/CreateProviderDialog";
import { AccountTable, type ProviderInfo } from "../components/tool-registry/AccountTable";
import { ToolTable, type ToolTableFilters } from "../components/tool-registry/ToolTable";
import { GrantTable } from "../components/tool-registry/GrantTable";
import type { CreateProviderFormData } from "../components/tool-registry/ProviderTable";
import { useProviders } from "../hooks/use-providers";
import { useAccounts } from "../hooks/use-accounts";
import { useTools } from "../hooks/use-tools";
import type { GrantListItem } from "../hooks/use-grants";
import { useMcpServers } from "../hooks/use-mcp-servers";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export type ToolRegistryTabId = "tools" | "providers" | "accounts" | "access";

export type ToolRegistryTab = {
  id: ToolRegistryTabId;
  label: string;
};

export const TOOL_REGISTRY_TABS: readonly ToolRegistryTab[] = [
  { id: "tools", label: "Tools" },
  { id: "providers", label: "Providers" },
  { id: "accounts", label: "Accounts" },
  { id: "access", label: "Access" },
] as const;

const VALID_TAB_IDS = new Set<string>(TOOL_REGISTRY_TABS.map((t) => t.id));
const DEFAULT_TAB: ToolRegistryTabId = "tools";

// ---------------------------------------------------------------------------
// Pure view model
// ---------------------------------------------------------------------------

export type ToolRegistryPageInput = {
  tabParam?: string;
  toolsCount: number;
  providersCount: number;
  accountsCount: number;
  mcpServersCount: number;
};

export type ToolRegistryViewModel = {
  activeTab: ToolRegistryTabId;
  showEmptyState: boolean;
  emptyStateCta: string;
  tabLabels: Record<ToolRegistryTabId, string>;
};

function countForTab(
  tabId: ToolRegistryTabId,
  input: ToolRegistryPageInput,
): number {
  switch (tabId) {
    case "tools":
      return input.toolsCount;
    case "providers":
      return input.providersCount;
    case "accounts":
      return input.accountsCount;
    case "access":
      return input.mcpServersCount;
  }
}

function formatTabLabel(baseLabel: string, count: number): string {
  return count > 0 ? `${baseLabel} (${count})` : baseLabel;
}

export function deriveToolRegistryViewModel(
  input: ToolRegistryPageInput,
): ToolRegistryViewModel {
  const activeTab: ToolRegistryTabId =
    input.tabParam && VALID_TAB_IDS.has(input.tabParam)
      ? (input.tabParam as ToolRegistryTabId)
      : DEFAULT_TAB;

  const activeCount = countForTab(activeTab, input);
  const showEmptyState = activeCount === 0;

  const tabLabels = Object.fromEntries(
    TOOL_REGISTRY_TABS.map((tab) => [
      tab.id,
      formatTabLabel(tab.label, countForTab(tab.id, input)),
    ]),
  ) as Record<ToolRegistryTabId, string>;

  return {
    activeTab,
    showEmptyState,
    emptyStateCta: "Add Provider",
    tabLabels,
  };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export function ToolRegistryPage() {
  const search = useSearch({ strict: false }) as { tab?: string };
  const navigate = useNavigate();
  const { tools, refresh: refreshTools } = useTools();
  const { providers, refresh: refreshProviders } = useProviders();
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const { mcpServers } = useMcpServers();

  // Access tab: track grants per expanded tool and toast messages
  const [accessToast, setAccessToast] = useState<string | undefined>();
  const grantsByToolId: Record<string, GrantListItem[]> = {};

  const handleRevokeGrant = useCallback(
    async (toolId: string, identityId: string) => {
      try {
        await fetch(
          `/api/workspaces/default/tools/${encodeURIComponent(toolId)}/grants/${encodeURIComponent(identityId)}`,
          { method: "DELETE" },
        );
        refreshTools();
      } catch {
        // silently fail for now
      }
    },
    [refreshTools],
  );

  const handleCreateProvider = useCallback(
    async (formData: CreateProviderFormData): Promise<{ error?: string }> => {
      try {
        const response = await fetch(`/api/workspaces/default/providers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!response.ok) {
          const body = await response.text();
          return { error: body || "Failed to create provider" };
        }
        refreshProviders();
        return {};
      } catch {
        return { error: "Network error" };
      }
    },
    [refreshProviders],
  );

  const handleDeleteProvider = useCallback(
    async (providerId: string) => {
      try {
        await fetch(`/api/workspaces/default/providers/${providerId}`, {
          method: "DELETE",
        });
        refreshProviders();
      } catch {
        // silently fail for now
      }
    },
    [refreshProviders],
  );

  const handleRevokeAccount = useCallback(
    async (accountId: string) => {
      try {
        await fetch(`/api/workspaces/default/accounts/${accountId}/revoke`, {
          method: "POST",
        });
        refreshAccounts();
      } catch {
        // silently fail for now
      }
    },
    [refreshAccounts],
  );

  const handleReconnectAccount = useCallback(
    (_accountId: string, _authMethod: string) => {
      // TODO: open connect dialog for reconnection
    },
    [],
  );

  const [toolFilters, setToolFilters] = useState<ToolTableFilters>({
    searchText: "",
  });

  const handleToolSearchChange = useCallback((searchText: string) => {
    setToolFilters((prev) => ({ ...prev, searchText }));
  }, []);

  const handleToolStatusFilterChange = useCallback((status?: string) => {
    setToolFilters((prev) => ({ ...prev, status }));
  }, []);

  const handleToolRiskFilterChange = useCallback((riskLevel?: string) => {
    setToolFilters((prev) => ({ ...prev, riskLevel }));
  }, []);

  const providerInfoList: ProviderInfo[] = providers.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    authMethod: p.auth_method,
  }));

  const vm = deriveToolRegistryViewModel({
    tabParam: search.tab,
    toolsCount: tools.length,
    providersCount: providers.length,
    accountsCount: accounts.length,
    mcpServersCount: mcpServers.length,
  });

  const handleTabChange = useCallback(
    (value: string) => {
      void navigate({
        to: "/tools",
        search: { tab: value },
      } as never);
    },
    [navigate],
  );

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Tool Registry</h1>
      </div>
      <Tabs value={vm.activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {TOOL_REGISTRY_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {vm.tabLabels[tab.id]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="tools">
          {vm.showEmptyState && vm.activeTab === "tools" ? (
            <EmptyState message="No tools discovered yet." cta={vm.emptyStateCta} />
          ) : (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search tools..."
                  value={toolFilters.searchText}
                  onChange={(e) => handleToolSearchChange(e.target.value)}
                  className="h-8 rounded-md border px-3 text-sm"
                />
                <select
                  value={toolFilters.status ?? ""}
                  onChange={(e) =>
                    handleToolStatusFilterChange(e.target.value || undefined)
                  }
                  className="h-8 rounded-md border px-2 text-sm"
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
                <select
                  value={toolFilters.riskLevel ?? ""}
                  onChange={(e) =>
                    handleToolRiskFilterChange(e.target.value || undefined)
                  }
                  className="h-8 rounded-md border px-2 text-sm"
                >
                  <option value="">All risk levels</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <ToolTable tools={tools} filters={toolFilters} />
            </div>
          )}
        </TabsContent>
        <TabsContent value="providers">
          <div className="flex justify-end py-2">
            <CreateProviderDialog onSubmit={handleCreateProvider} />
          </div>
          {vm.showEmptyState && vm.activeTab === "providers" ? (
            <EmptyState message="No credential providers configured." cta={vm.emptyStateCta} />
          ) : (
            <ProviderTable providers={providers} onDelete={handleDeleteProvider} />
          )}
        </TabsContent>
        <TabsContent value="accounts">
          {vm.showEmptyState && vm.activeTab === "accounts" ? (
            <EmptyState message="No accounts connected." cta={vm.emptyStateCta} />
          ) : (
            <AccountTable
              accounts={accounts}
              providers={providerInfoList}
              onRevoke={handleRevokeAccount}
              onReconnect={handleReconnectAccount}
            />
          )}
        </TabsContent>
        <TabsContent value="access">
          {accessToast && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {accessToast}
              <button
                className="ml-2 font-medium underline"
                onClick={() => setAccessToast(undefined)}
              >
                Dismiss
              </button>
            </div>
          )}
          {vm.showEmptyState && vm.activeTab === "access" ? (
            <EmptyState message="No tools available to manage access." cta={vm.emptyStateCta} />
          ) : (
            <GrantTable
              tools={tools}
              grantsByToolId={grantsByToolId}
              onGrantAccess={(_toolId) => {
                // CreateGrantDialog will be opened by the GrantTable component
              }}
              onRevokeGrant={handleRevokeGrant}
            />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state component
// ---------------------------------------------------------------------------

function EmptyState({ message, cta }: { message: string; cta: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button size="sm">{cta}</Button>
    </div>
  );
}
