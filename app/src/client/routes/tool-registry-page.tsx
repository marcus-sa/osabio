import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { ProviderTable } from "../components/tool-registry/ProviderTable";
import { CreateProviderDialog } from "../components/tool-registry/CreateProviderDialog";
import type { CreateProviderFormData } from "../components/tool-registry/ProviderTable";
import { useProviders } from "../hooks/use-providers";
import { useAccounts } from "../hooks/use-accounts";
import { useTools } from "../hooks/use-tools";
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
  const { tools } = useTools();
  const { providers, refresh: refreshProviders } = useProviders();
  const { accounts } = useAccounts();
  const { mcpServers } = useMcpServers();

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
            <p className="py-4 text-sm text-muted-foreground">Tools list placeholder</p>
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
            <p className="py-4 text-sm text-muted-foreground">Accounts list placeholder</p>
          )}
        </TabsContent>
        <TabsContent value="access">
          {vm.showEmptyState && vm.activeTab === "access" ? (
            <EmptyState message="No MCP servers registered." cta={vm.emptyStateCta} />
          ) : (
            <p className="py-4 text-sm text-muted-foreground">Access / MCP servers list placeholder</p>
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
