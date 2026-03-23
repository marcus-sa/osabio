import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { McpServerListItem } from "../../hooks/use-mcp-servers";
import type { ProviderListItem } from "../../hooks/use-providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusIndicator = {
  color: "green" | "red" | "gray";
  label: string;
};

export type McpServerRowViewModel = {
  id: string;
  name: string;
  url: string;
  statusIndicator: StatusIndicator;
  toolCountDisplay: string;
  lastDiscoveryDisplay: string;
  lastError?: string;
  hasDiscoverAction: boolean;
  hasSyncAction: boolean;
};

export type McpServerSectionViewModel = {
  rows: McpServerRowViewModel[];
  showEmptyState: boolean;
  emptyStateMessage: string;
  emptyStateCta: string;
};

export type McpServerSectionInput = {
  servers: McpServerListItem[];
  existingNames: string[];
};

export type McpTransport = "sse" | "streamable-http";

export type AddMcpServerFormData = {
  name: string;
  url: string;
  transport: McpTransport;
  credentialProviderId?: string;
};

export type AddMcpServerFieldName = "name" | "url" | "transport" | "credentialProviderId";

export type AddMcpServerValidationResult = {
  isValid: boolean;
  errors: Partial<Record<AddMcpServerFieldName, string>>;
};

export type RemoveConfirmationViewModel = {
  title: string;
  warning: string;
  isDestructive: boolean;
};

// ---------------------------------------------------------------------------
// Status indicator
// ---------------------------------------------------------------------------

export function deriveStatusIndicator(status?: string): StatusIndicator {
  switch (status) {
    case "ok":
      return { color: "green", label: "Connected" };
    case "error":
      return { color: "red", label: "Error" };
    default:
      return { color: "gray", label: "Unknown" };
  }
}

// ---------------------------------------------------------------------------
// Tool count formatting
// ---------------------------------------------------------------------------

function formatToolCount(count: number): string {
  return count === 1 ? "1 tool" : `${count} tools`;
}

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return "Never";
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Server row view model
// ---------------------------------------------------------------------------

export function deriveMcpServerRowViewModel(
  server: McpServerListItem,
): McpServerRowViewModel {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    statusIndicator: deriveStatusIndicator(server.last_status),
    toolCountDisplay: formatToolCount(server.tool_count),
    lastDiscoveryDisplay: formatRelativeTime(server.created_at),
    hasDiscoverAction: true,
    hasSyncAction: true,
  };
}

// ---------------------------------------------------------------------------
// Section view model
// ---------------------------------------------------------------------------

const EMPTY_STATE_MESSAGE = "No MCP servers configured.";
const EMPTY_STATE_CTA = "Add MCP Server";

export function deriveMcpServerSectionViewModel(
  input: McpServerSectionInput,
): McpServerSectionViewModel {
  const rows = input.servers.map(deriveMcpServerRowViewModel);
  return {
    rows,
    showEmptyState: rows.length === 0,
    emptyStateMessage: EMPTY_STATE_MESSAGE,
    emptyStateCta: EMPTY_STATE_CTA,
  };
}

// ---------------------------------------------------------------------------
// Add server form validation
// ---------------------------------------------------------------------------

function isValidHttpUrl(urlString: string): { valid: boolean; error?: string } {
  if (urlString.trim() === "") {
    return { valid: false, error: "URL is required" };
  }
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "URL must use http:// or https://" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "URL must use http:// or https://" };
  }
}

export function validateAddMcpServerForm(
  formData: AddMcpServerFormData,
  existingNames: string[],
): AddMcpServerValidationResult {
  const errors: Partial<Record<AddMcpServerFieldName, string>> = {};

  // Name validation
  if (formData.name.trim() === "") {
    errors.name = "Name is required";
  } else if (existingNames.includes(formData.name.trim())) {
    errors.name = "A server with this name already exists";
  }

  // URL validation
  const urlValidation = isValidHttpUrl(formData.url);
  if (!urlValidation.valid) {
    errors.url = urlValidation.error;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Remove confirmation view model
// ---------------------------------------------------------------------------

function formatRemoveWarning(toolCount: number): string {
  if (toolCount === 0) return "This action cannot be undone.";
  const noun = toolCount === 1 ? "tool" : "tools";
  return `${toolCount} ${noun} discovered from this server will be disabled. This action cannot be undone.`;
}

export function deriveRemoveConfirmationViewModel(
  serverName: string,
  toolCount: number,
): RemoveConfirmationViewModel {
  return {
    title: `Remove ${serverName}?`,
    warning: formatRemoveWarning(toolCount),
    isDestructive: true,
  };
}

// ---------------------------------------------------------------------------
// Status dot component
// ---------------------------------------------------------------------------

const STATUS_COLOR_CLASSES: Record<StatusIndicator["color"], string> = {
  green: "bg-green-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
};

function StatusDot({ indicator }: { indicator: StatusIndicator }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${STATUS_COLOR_CLASSES[indicator.color]}`}
      title={indicator.label}
      aria-label={indicator.label}
    />
  );
}

// ---------------------------------------------------------------------------
// Remove confirmation dialog
// ---------------------------------------------------------------------------

type RemoveMcpServerDialogProps = {
  serverName: string;
  toolCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function RemoveMcpServerDialog({
  serverName,
  toolCount,
  open,
  onOpenChange,
  onConfirm,
}: RemoveMcpServerDialogProps) {
  const vm = deriveRemoveConfirmationViewModel(serverName, toolCount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{vm.title}</DialogTitle>
          <DialogDescription>{vm.warning}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add MCP Server dialog
// ---------------------------------------------------------------------------

export type AddMcpServerDialogProps = {
  onSubmit: (formData: AddMcpServerFormData) => Promise<{ error?: string }>;
  existingNames: string[];
  providers: ProviderListItem[];
  trigger?: React.ReactNode;
};

function initialFormData(): AddMcpServerFormData {
  return {
    name: "",
    url: "",
    transport: "streamable-http",
  };
}

export function AddMcpServerDialog({
  onSubmit,
  existingNames,
  providers,
  trigger,
}: AddMcpServerDialogProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<AddMcpServerFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const validation = validateAddMcpServerForm(formData, existingNames);

  const handleFieldChange = useCallback(
    (field: AddMcpServerFieldName, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSubmitError(undefined);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!validation.isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(undefined);

    const result = await onSubmit(formData);

    setSubmitting(false);
    if (result.error) {
      setSubmitError(result.error);
    } else {
      setOpen(false);
      setFormData(initialFormData());
    }
  }, [validation.isValid, submitting, formData, onSubmit]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen && !submitting) {
        setFormData(initialFormData());
        setSubmitError(undefined);
      }
    },
    [submitting],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger ? <>{trigger}</> : <Button size="sm">Add MCP Server</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Connect an MCP server to discover and sync tools.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              placeholder="e.g. github-mcp"
              value={formData.name}
              onChange={(e) => handleFieldChange("name", e.target.value)}
              aria-invalid={validation.errors.name ? true : undefined}
            />
            {validation.errors.name && (
              <p className="text-xs text-destructive">{validation.errors.name}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              type="url"
              placeholder="https://mcp-server.example.com"
              value={formData.url}
              onChange={(e) => handleFieldChange("url", e.target.value)}
              aria-invalid={validation.errors.url ? true : undefined}
            />
            {validation.errors.url && (
              <p className="text-xs text-destructive">{validation.errors.url}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-transport">Transport</Label>
            <Select
              value={formData.transport}
              onValueChange={(v) => { if (v) handleFieldChange("transport", v); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {providers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-provider">Credential Provider (optional)</Label>
              <Select
                value={formData.credentialProviderId ?? ""}
                onValueChange={(v) => handleFieldChange("credentialProviderId", v || "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            disabled={!validation.isValid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Adding..." : "Add Server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// MCP Server Section (collapsible at top of Tools tab)
// ---------------------------------------------------------------------------

type McpServerSectionProps = {
  servers: McpServerListItem[];
  providers: ProviderListItem[];
  onAddServer: (formData: AddMcpServerFormData) => Promise<{ error?: string }>;
  onRemoveServer: (serverId: string) => void;
  onDiscover: (serverId: string) => void;
  onSync: (serverId: string) => void;
};

export function McpServerSection({
  servers,
  providers,
  onAddServer,
  onRemoveServer,
  onDiscover,
  onSync,
}: McpServerSectionProps) {
  const existingNames = servers.map((s) => s.name);
  const vm = deriveMcpServerSectionViewModel({ servers, existingNames });
  const [removeTarget, setRemoveTarget] = useState<McpServerRowViewModel | undefined>();
  const [isOpen, setIsOpen] = useState(true);

  const handleRemoveClick = useCallback((row: McpServerRowViewModel) => {
    setRemoveTarget(row);
  }, []);

  const handleRemoveConfirm = useCallback(() => {
    if (!removeTarget) return;
    onRemoveServer(removeTarget.id);
    setRemoveTarget(undefined);
  }, [removeTarget, onRemoveServer]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
          <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>&#9654;</span>
          MCP Servers ({servers.length})
        </CollapsibleTrigger>
        <AddMcpServerDialog
          onSubmit={onAddServer}
          existingNames={existingNames}
          providers={providers}
        />
      </div>

      <CollapsibleContent>
        {vm.showEmptyState ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">{vm.emptyStateMessage}</p>
            <AddMcpServerDialog
              onSubmit={onAddServer}
              existingNames={existingNames}
              providers={providers}
              trigger={<Button size="sm">{vm.emptyStateCta}</Button>}
            />
          </div>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Tools</th>
                <th className="px-3 py-2 font-medium">Last Discovery</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {vm.rows.map((row) => {
                return (
                  <tr key={row.id} className="border-b">
                    <td className="px-3 py-2">
                      <StatusDot indicator={row.statusIndicator} />
                    </td>
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.url}</td>
                    <td className="px-3 py-2">{row.toolCountDisplay}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.lastDiscoveryDisplay}
                    </td>
                    <td className="flex gap-1 px-3 py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onDiscover(row.id)}
                      >
                        Discover
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSync(row.id)}
                      >
                        Sync
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => handleRemoveClick(row)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CollapsibleContent>

      {removeTarget && (
        <RemoveMcpServerDialog
          serverName={removeTarget.name}
          toolCount={servers.find((s) => s.id === removeTarget.id)?.tool_count ?? 0}
          open={!!removeTarget}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(undefined);
          }}
          onConfirm={handleRemoveConfirm}
        />
      )}
    </Collapsible>
  );
}
