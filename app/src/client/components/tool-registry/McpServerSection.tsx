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
  color: "green" | "red" | "yellow" | "gray";
  label: string;
};

export type AuthMode = "none" | "static_headers" | "oauth" | "provider";

export type McpServerRowViewModel = {
  id: string;
  name: string;
  url: string;
  authMode: AuthMode;
  statusIndicator: StatusIndicator;
  authStatusLabel: string;
  toolCountDisplay: string;
  lastDiscoveryDisplay: string;
  lastError?: string;
  hasDiscoverAction: boolean;
  hasSyncAction: boolean;
  showAuthorizeAction: boolean;
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

export type StaticHeaderEntry = {
  name: string;
  value: string;
};

export type AddMcpServerFormData = {
  name: string;
  url: string;
  transport: McpTransport;
  auth_mode: AuthMode;
  static_headers: StaticHeaderEntry[];
  credentialProviderId?: string;
};

export type AddMcpServerFieldName = "name" | "url" | "transport" | "auth_mode" | "credentialProviderId";

export type AddMcpServerValidationResult = {
  isValid: boolean;
  errors: Partial<Record<AddMcpServerFieldName | "static_headers", string>>;
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
    case "auth_error":
      return { color: "yellow", label: "Auth Error" };
    default:
      return { color: "gray", label: "Unknown" };
  }
}

// ---------------------------------------------------------------------------
// Auth status label
// ---------------------------------------------------------------------------

export function deriveAuthStatusLabel(server: McpServerListItem): string {
  switch (server.auth_mode) {
    case "none":
      return "None";
    case "static_headers":
      return server.has_static_headers ? "Headers" : "No headers";
    case "oauth":
      return server.last_status === "auth_error" ? "Needs reauth" : "OAuth";
    case "provider":
      return server.provider_name ?? "Provider";
    default:
      return "None";
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

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return "Never";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return relativeFormatter.format(-diffSeconds, "second");
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return relativeFormatter.format(-diffMinutes, "minute");
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return relativeFormatter.format(-diffHours, "hour");
  const diffDays = Math.floor(diffHours / 24);
  return relativeFormatter.format(-diffDays, "day");
}

// ---------------------------------------------------------------------------
// Server row view model
// ---------------------------------------------------------------------------

export function deriveMcpServerRowViewModel(
  server: McpServerListItem,
): McpServerRowViewModel {
  const authMode = (server.auth_mode ?? "none") as AuthMode;
  const showAuthorize = authMode === "oauth" && (
    server.last_status === "auth_error" || !server.provider_id
  );

  return {
    id: server.id,
    name: server.name,
    url: server.url,
    authMode,
    statusIndicator: deriveStatusIndicator(server.last_status),
    authStatusLabel: deriveAuthStatusLabel(server),
    toolCountDisplay: formatToolCount(server.tool_count),
    lastDiscoveryDisplay: formatRelativeTime(server.created_at),
    hasDiscoverAction: true,
    hasSyncAction: true,
    showAuthorizeAction: showAuthorize,
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
  const errors: Partial<Record<AddMcpServerFieldName | "static_headers", string>> = {};

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

  // Static headers validation
  if (formData.auth_mode === "static_headers") {
    if (formData.static_headers.length === 0) {
      errors.static_headers = "At least one header is required";
    } else {
      const hasEmpty = formData.static_headers.some(
        (h) => h.name.trim() === "" || h.value.trim() === "",
      );
      if (hasEmpty) {
        errors.static_headers = "All headers must have a name and value";
      }
    }
  }

  // Provider validation
  if (formData.auth_mode === "provider" && !formData.credentialProviderId) {
    errors.credentialProviderId = "Select a credential provider";
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
  yellow: "bg-yellow-500",
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
// Auth mode badge
// ---------------------------------------------------------------------------

function AuthBadge({ mode, label }: { mode: AuthMode; label: string }) {
  if (mode === "none") {
    return <span className="text-muted-foreground">—</span>;
  }
  const badgeColor = mode === "oauth"
    ? "bg-blue-100 text-blue-700"
    : mode === "static_headers"
      ? "bg-gray-100 text-gray-700"
      : "bg-purple-100 text-purple-700";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Static headers editor
// ---------------------------------------------------------------------------

type StaticHeadersEditorProps = {
  headers: StaticHeaderEntry[];
  onChange: (headers: StaticHeaderEntry[]) => void;
  error?: string;
};

function StaticHeadersEditor({ headers, onChange, error }: StaticHeadersEditorProps) {
  const addHeader = useCallback(() => {
    onChange([...headers, { name: "", value: "" }]);
  }, [headers, onChange]);

  const removeHeader = useCallback(
    (index: number) => {
      onChange(headers.filter((_, i) => i !== index));
    },
    [headers, onChange],
  );

  const updateHeader = useCallback(
    (index: number, field: "name" | "value", val: string) => {
      const updated = headers.map((h, i) =>
        i === index ? { ...h, [field]: val } : h,
      );
      onChange(updated);
    },
    [headers, onChange],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Headers</Label>
        <Button type="button" variant="outline" size="sm" onClick={addHeader}>
          Add Header
        </Button>
      </div>
      {headers.map((header, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            placeholder="Header name"
            value={header.name}
            onChange={(e) => updateHeader(index, "name", e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Header value"
            type="password"
            value={header.value}
            onChange={(e) => updateHeader(index, "value", e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => removeHeader(index)}
          >
            X
          </Button>
        </div>
      ))}
      {headers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Click "Add Header" to add authentication headers.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
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
    auth_mode: "none",
    static_headers: [],
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

  const handleAuthModeChange = useCallback((mode: string) => {
    setFormData((prev) => ({
      ...prev,
      auth_mode: mode as AuthMode,
      // Reset mode-specific fields
      static_headers: mode === "static_headers" ? [{ name: "", value: "" }] : [],
      credentialProviderId: mode === "provider" ? prev.credentialProviderId : undefined,
    }));
    setSubmitError(undefined);
  }, []);

  const handleHeadersChange = useCallback((headers: StaticHeaderEntry[]) => {
    setFormData((prev) => ({ ...prev, static_headers: headers }));
  }, []);

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
      <DialogTrigger render={trigger ?? <Button size="sm">Add MCP Server</Button>} />
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-auth-mode">Authentication</Label>
            <Select
              value={formData.auth_mode}
              onValueChange={(v) => { if (v) handleAuthModeChange(v); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="static_headers">Static Headers</SelectItem>
                <SelectItem value="oauth">OAuth 2.1 (auto-discover)</SelectItem>
                {providers.length > 0 && (
                  <SelectItem value="provider">Credential Provider</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {formData.auth_mode === "static_headers" && (
            <StaticHeadersEditor
              headers={formData.static_headers}
              onChange={handleHeadersChange}
              error={validation.errors.static_headers}
            />
          )}

          {formData.auth_mode === "oauth" && (
            <p className="text-xs text-muted-foreground">
              After adding, use "Discover Auth" to detect the server's OAuth configuration automatically.
            </p>
          )}

          {formData.auth_mode === "provider" && providers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-provider">Credential Provider</Label>
              <Select
                value={formData.credentialProviderId ?? ""}
                onValueChange={(v) => handleFieldChange("credentialProviderId", v || "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {validation.errors.credentialProviderId && (
                <p className="text-xs text-destructive">{validation.errors.credentialProviderId}</p>
              )}
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
  onDiscoverAuth: (serverId: string) => void;
  onAuthorize: (serverId: string) => void;
};

export function McpServerSection({
  servers,
  providers,
  onAddServer,
  onRemoveServer,
  onDiscover,
  onSync,
  onDiscoverAuth,
  onAuthorize,
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
                <th className="px-3 py-2 font-medium">Auth</th>
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
                    <td className="px-3 py-2">
                      <AuthBadge mode={row.authMode} label={row.authStatusLabel} />
                    </td>
                    <td className="px-3 py-2">{row.toolCountDisplay}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.lastDiscoveryDisplay}
                    </td>
                    <td className="flex gap-1 px-3 py-2">
                      {row.authMode === "oauth" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onDiscoverAuth(row.id)}
                          >
                            Discover Auth
                          </Button>
                          {row.showAuthorizeAction && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => onAuthorize(row.id)}
                            >
                              Authorize
                            </Button>
                          )}
                        </>
                      )}
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
