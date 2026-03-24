import { Fragment, useState } from "react";
import { Badge } from "../ui/badge";
import type { ToolListItem } from "../../hooks/use-tools";
import { ToolDetailPanel, type ToolDetailActions } from "./ToolDetailPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BadgeViewModel = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
};

export type ToolRowViewModel = {
  id: string;
  name: string;
  truncatedDescription: string;
  riskBadge: BadgeViewModel;
  statusBadge: BadgeViewModel;
  grantCount: number;
  governanceCount: number;
  isGoverned: boolean;
};

export type ToolGroupViewModel = {
  /** Display label for the group header. Server name or "Ungrouped". */
  label: string;
  /** Server ID if tools belong to an MCP server, undefined for manual tools. */
  serverId?: string;
  toolCount: number;
  rows: ToolRowViewModel[];
};

export type ToolTableViewModel = {
  groups: ToolGroupViewModel[];
  showEmptyState: boolean;
  showEmptySearch: boolean;
  emptyStateMessage: string;
  emptySearchMessage: string;
};

export type ToolTableFilters = {
  searchText: string;
  status?: string;
  riskLevel?: string;
};

export type ToolTableInput = {
  tools: ToolListItem[];
  filters: ToolTableFilters;
};

// ---------------------------------------------------------------------------
// Badge derivation functions
// ---------------------------------------------------------------------------

const RISK_BADGES: Record<string, BadgeViewModel> = {
  low: { label: "Low", variant: "outline", className: "text-green-600 border-green-300" },
  medium: { label: "Medium", variant: "outline", className: "text-amber-600 border-amber-300" },
  high: { label: "High", variant: "outline", className: "text-red-600 border-red-300" },
  critical: { label: "Critical", variant: "destructive" },
};

export function deriveRiskBadge(riskLevel: string): BadgeViewModel {
  return RISK_BADGES[riskLevel] ?? { label: riskLevel, variant: "outline" };
}

const STATUS_BADGES: Record<string, BadgeViewModel> = {
  active: { label: "Active", variant: "default" },
  disabled: { label: "Disabled", variant: "secondary" },
};

export function deriveStatusBadge(status: string): BadgeViewModel {
  return STATUS_BADGES[status] ?? { label: status, variant: "outline" };
}

// ---------------------------------------------------------------------------
// Description truncation
// ---------------------------------------------------------------------------

const MAX_DESCRIPTION_LENGTH = 100;

function truncateDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description;
  return `${description.slice(0, MAX_DESCRIPTION_LENGTH)}...`;
}

// ---------------------------------------------------------------------------
// Row derivation
// ---------------------------------------------------------------------------

function toToolRow(tool: ToolListItem): ToolRowViewModel {
  return {
    id: tool.id,
    name: tool.name,
    truncatedDescription: truncateDescription(tool.description),
    riskBadge: deriveRiskBadge(tool.risk_level),
    statusBadge: deriveStatusBadge(tool.status),
    grantCount: tool.grant_count,
    governanceCount: tool.governance_count,
    isGoverned: tool.governance_count > 0,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function matchesSearchText(tool: ToolListItem, searchText: string): boolean {
  if (searchText === "") return true;
  const lowerSearch = searchText.toLowerCase();
  return (
    tool.name.toLowerCase().includes(lowerSearch) ||
    tool.description.toLowerCase().includes(lowerSearch)
  );
}

export function filterTools(
  tools: ToolListItem[],
  filters: ToolTableFilters,
): ToolListItem[] {
  return tools.filter((tool) => {
    if (filters.status && tool.status !== filters.status) return false;
    if (filters.riskLevel && tool.risk_level !== filters.riskLevel) return false;
    if (!matchesSearchText(tool, filters.searchText)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Grouping — by MCP server
// ---------------------------------------------------------------------------

const UNGROUPED_LABEL = "Ungrouped";

export function groupToolsByServer(tools: ToolListItem[]): ToolGroupViewModel[] {
  const serverGroups = new Map<string, { name: string; id: string; tools: ToolListItem[] }>();
  const ungrouped: ToolListItem[] = [];

  for (const tool of tools) {
    if (tool.source_server_id && tool.source_server_name) {
      const existing = serverGroups.get(tool.source_server_id);
      if (existing) {
        existing.tools.push(tool);
      } else {
        serverGroups.set(tool.source_server_id, {
          name: tool.source_server_name,
          id: tool.source_server_id,
          tools: [tool],
        });
      }
    } else {
      ungrouped.push(tool);
    }
  }

  const groups: ToolGroupViewModel[] = [];

  // Server groups first, sorted by name
  const sorted = Array.from(serverGroups.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const group of sorted) {
    groups.push({
      label: group.name,
      serverId: group.id,
      toolCount: group.tools.length,
      rows: group.tools.map(toToolRow),
    });
  }

  // Ungrouped tools last
  if (ungrouped.length > 0) {
    groups.push({
      label: UNGROUPED_LABEL,
      toolCount: ungrouped.length,
      rows: ungrouped.map(toToolRow),
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Main view model derivation
// ---------------------------------------------------------------------------

const EMPTY_STATE_MESSAGE = "No tools discovered yet.";
const EMPTY_SEARCH_MESSAGE = "No tools match your search";

export function deriveToolTableViewModel(input: ToolTableInput): ToolTableViewModel {
  const filteredTools = filterTools(input.tools, input.filters);
  const groups = groupToolsByServer(filteredTools);

  const hasTools = input.tools.length > 0;
  const hasFilteredResults = filteredTools.length > 0;
  const hasActiveFilters =
    input.filters.searchText !== "" ||
    input.filters.status !== undefined ||
    input.filters.riskLevel !== undefined;

  return {
    groups,
    showEmptyState: !hasTools,
    showEmptySearch: hasTools && !hasFilteredResults && hasActiveFilters,
    emptyStateMessage: EMPTY_STATE_MESSAGE,
    emptySearchMessage: EMPTY_SEARCH_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// React: Tool table component
// ---------------------------------------------------------------------------

type ToolTableProps = {
  tools: ToolListItem[];
  filters: ToolTableFilters;
  actions?: ToolDetailActions;
};

export function ToolTable({ tools, filters, actions }: ToolTableProps) {
  const [expandedToolId, setExpandedToolId] = useState<string | undefined>();
  const vm = deriveToolTableViewModel({ tools, filters });

  function handleRowClick(toolId: string) {
    setExpandedToolId((current) => (current === toolId ? undefined : toolId));
  }

  if (vm.showEmptyState) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{vm.emptyStateMessage}</p>
      </div>
    );
  }

  if (vm.showEmptySearch) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{vm.emptySearchMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {vm.groups.map((group) => (
        <div key={group.serverId ?? group.label}>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="text-sm font-semibold">{group.label}</span>
            <Badge variant="secondary">{group.toolCount}</Badge>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Grants</th>
                <th className="px-3 py-2 font-medium">Governance</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className="cursor-pointer border-b hover:bg-muted/50"
                    onClick={() => handleRowClick(row.id)}
                  >
                    <td className="px-3 py-2 font-medium">
                      {row.isGoverned && (
                        <span className="mr-1" title="Governed tool" aria-label="shield">
                          &#x1F6E1;
                        </span>
                      )}
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.truncatedDescription}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.riskBadge.variant} className={row.riskBadge.className}>
                        {row.riskBadge.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.statusBadge.variant}>
                        {row.statusBadge.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{row.grantCount}</td>
                    <td className="px-3 py-2">{row.governanceCount}</td>
                  </tr>
                  {expandedToolId === row.id && (
                    <ToolDetailPanel toolId={row.id} toolName={row.name} actions={actions} />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
