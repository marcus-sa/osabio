import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type {
  ToolSyncAction,
  ToolSyncDetail,
  ToolRiskLevel,
} from "../../../server/tool-registry/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionBadge = {
  color: "green" | "amber" | "red" | "muted";
  label: string;
};

export type DiscoveryToolRow = {
  name: string;
  description: string;
  actionBadge: ActionBadge;
  riskLevel: ToolRiskLevel;
  originalRiskLevel: ToolRiskLevel;
  hasSchemaDiff: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type DiscoveryPanelInput = {
  serverId: string;
  tools: ToolSyncDetail[];
};

export type DiscoveryPanelViewModel = {
  serverId: string;
  rows: DiscoveryToolRow[];
  summaryCounts: SummaryCounts;
  defaultSelections: Set<string>;
};

export type SummaryCounts = {
  create: number;
  update: number;
  disable: number;
  unchanged: number;
  total: number;
};

export type ImportPayload = {
  serverId: string;
  selectedTools: string[];
  riskOverrides: Record<string, ToolRiskLevel>;
};

// ---------------------------------------------------------------------------
// Pure view-model derivation functions
// ---------------------------------------------------------------------------

const ACTION_BADGE_MAP: Record<ToolSyncAction, ActionBadge> = {
  create: { color: "green", label: "New" },
  update: { color: "amber", label: "Updated" },
  disable: { color: "red", label: "Disabled" },
  unchanged: { color: "muted", label: "Unchanged" },
};

export function deriveActionBadge(action: ToolSyncAction): ActionBadge {
  return ACTION_BADGE_MAP[action];
}

export function deriveToolRowViewModel(tool: ToolSyncDetail): DiscoveryToolRow {
  return {
    name: tool.name,
    description: tool.description,
    actionBadge: deriveActionBadge(tool.action),
    riskLevel: tool.risk_level,
    originalRiskLevel: tool.risk_level,
    hasSchemaDiff: tool.action === "update",
    inputSchema: tool.input_schema,
    outputSchema: tool.output_schema,
  };
}

export function deriveDefaultSelections(
  tools: ToolSyncDetail[],
): Set<string> {
  const selected = new Set<string>();
  for (const tool of tools) {
    if (tool.action === "create" || tool.action === "update") {
      selected.add(tool.name);
    }
  }
  return selected;
}

export function applyRiskOverride(
  rows: DiscoveryToolRow[],
  toolName: string,
  newRiskLevel: ToolRiskLevel,
): DiscoveryToolRow[] {
  return rows.map((row) =>
    row.name === toolName ? { ...row, riskLevel: newRiskLevel } : row,
  );
}

export function deriveImportPayload(
  serverId: string,
  rows: DiscoveryToolRow[],
  selected: Set<string>,
): ImportPayload {
  const selectedTools: string[] = [];
  for (const row of rows) {
    if (selected.has(row.name)) {
      selectedTools.push(row.name);
    }
  }

  return {
    serverId,
    selectedTools,
    riskOverrides: deriveRiskOverrides(rows, selected),
  };
}

function deriveRiskOverrides(
  rows: DiscoveryToolRow[],
  selected: Set<string>,
): Record<string, ToolRiskLevel> {
  const overrides: Record<string, ToolRiskLevel> = {};
  for (const row of rows) {
    if (!selected.has(row.name)) continue;
    if (row.riskLevel !== row.originalRiskLevel) {
      overrides[row.name] = row.riskLevel;
    }
  }
  return overrides;
}

export function deriveSummaryCounts(
  tools: ToolSyncDetail[],
): SummaryCounts {
  const counts: SummaryCounts = {
    create: 0,
    update: 0,
    disable: 0,
    unchanged: 0,
    total: tools.length,
  };

  for (const tool of tools) {
    counts[tool.action]++;
  }

  return counts;
}

export function deriveDiscoveryPanelViewModel(
  input: DiscoveryPanelInput,
): DiscoveryPanelViewModel {
  return {
    serverId: input.serverId,
    rows: input.tools.map(deriveToolRowViewModel),
    summaryCounts: deriveSummaryCounts(input.tools),
    defaultSelections: deriveDefaultSelections(input.tools),
  };
}

// ---------------------------------------------------------------------------
// Badge color classes
// ---------------------------------------------------------------------------

const BADGE_COLOR_CLASSES: Record<ActionBadge["color"], string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  muted: "bg-gray-100 text-gray-500",
};

const RISK_LEVELS: ToolRiskLevel[] = ["low", "medium", "high", "critical"];

// ---------------------------------------------------------------------------
// DiscoveryReviewPanel component
// ---------------------------------------------------------------------------

export type DiscoveryReviewPanelProps = {
  serverId: string;
  tools: ToolSyncDetail[];
  onImport: (payload: ImportPayload) => Promise<void>;
  onCancel: () => void;
};

export function DiscoveryReviewPanel({
  serverId,
  tools,
  onImport,
  onCancel,
}: DiscoveryReviewPanelProps) {
  const vm = deriveDiscoveryPanelViewModel({ serverId, tools });

  const [selections, setSelections] = useState<Set<string>>(
    () => vm.defaultSelections,
  );
  const [rows, setRows] = useState<DiscoveryToolRow[]>(() => vm.rows);
  const [importing, setImporting] = useState(false);
  const [unchangedExpanded, setUnchangedExpanded] = useState(false);

  const actionableRows = rows.filter((r) => r.actionBadge.color !== "muted");
  const unchangedRows = rows.filter((r) => r.actionBadge.color === "muted");

  const handleToggleSelection = useCallback((toolName: string) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  }, []);

  const handleRiskOverride = useCallback(
    (toolName: string, riskLevel: ToolRiskLevel) => {
      setRows((prev) => applyRiskOverride(prev, toolName, riskLevel));
    },
    [],
  );

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const payload = deriveImportPayload(serverId, rows, selections);
      await onImport(payload);
    } finally {
      setImporting(false);
    }
  }, [serverId, rows, selections, onImport]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Discovery Results</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{vm.summaryCounts.create} new</span>
          <span>{vm.summaryCounts.update} updated</span>
          <span>{vm.summaryCounts.disable} disabled</span>
          <span>{vm.summaryCounts.unchanged} unchanged</span>
        </div>
      </div>

      {/* Actionable tools */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="w-8 px-2 py-1" />
            <th className="px-2 py-1 font-medium">Tool</th>
            <th className="px-2 py-1 font-medium">Action</th>
            <th className="px-2 py-1 font-medium">Risk Level</th>
            <th className="px-2 py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {actionableRows.map((row) => (
            <ToolRow
              key={row.name}
              row={row}
              selected={selections.has(row.name)}
              onToggle={() => handleToggleSelection(row.name)}
              onRiskChange={(risk) => handleRiskOverride(row.name, risk)}
            />
          ))}
        </tbody>
      </table>

      {/* Unchanged tools (collapsed by default) */}
      {unchangedRows.length > 0 && (
        <Collapsible open={unchangedExpanded} onOpenChange={setUnchangedExpanded}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`transition-transform ${unchangedExpanded ? "rotate-90" : ""}`}>
              &#9654;
            </span>
            {unchangedRows.length} unchanged tool{unchangedRows.length !== 1 ? "s" : ""}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {unchangedRows.map((row) => (
                  <ToolRow
                    key={row.name}
                    row={row}
                    selected={selections.has(row.name)}
                    onToggle={() => handleToggleSelection(row.name)}
                    onRiskChange={(risk) => handleRiskOverride(row.name, risk)}
                  />
                ))}
              </tbody>
            </table>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={selections.size === 0 || importing}
          onClick={handleImport}
        >
          {importing ? "Importing..." : `Import Selected (${selections.size})`}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolRow component
// ---------------------------------------------------------------------------

type ToolRowProps = {
  row: DiscoveryToolRow;
  selected: boolean;
  onToggle: () => void;
  onRiskChange: (risk: ToolRiskLevel) => void;
};

function ToolRow({ row, selected, onToggle, onRiskChange }: ToolRowProps) {
  const [diffExpanded, setDiffExpanded] = useState(false);

  return (
    <>
      <tr className="border-b">
        <td className="px-2 py-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${row.name}`}
          />
        </td>
        <td className="px-2 py-1">
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">{row.description}</div>
        </td>
        <td className="px-2 py-1">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_COLOR_CLASSES[row.actionBadge.color]}`}
          >
            {row.actionBadge.label}
          </span>
        </td>
        <td className="px-2 py-1">
          <Select
            value={row.riskLevel}
            onValueChange={(v) => {
              if (v) onRiskChange(v as ToolRiskLevel);
            }}
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISK_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className="px-2 py-1">
          {row.hasSchemaDiff && (
            <button
              className="text-xs text-blue-600 underline"
              onClick={() => setDiffExpanded(!diffExpanded)}
            >
              {diffExpanded ? "Hide diff" : "Show diff"}
            </button>
          )}
        </td>
      </tr>
      {diffExpanded && row.hasSchemaDiff && (
        <tr>
          <td colSpan={5} className="bg-muted/50 px-4 py-2">
            <pre className="max-h-48 overflow-auto text-xs">
              {JSON.stringify(row.inputSchema, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
