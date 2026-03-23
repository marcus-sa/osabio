import { useCallback, useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { AccountListItem } from "../../hooks/use-accounts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusBadge = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

export type AccountAction = {
  label: string;
  kind: "revoke" | "reconnect";
};

export type AccountRowViewModel = {
  id: string;
  providerId: string;
  providerDisplayName: string;
  statusBadge: StatusBadge;
  action: AccountAction;
  connectedAt: string;
  authMethod: string;
};

export type AccountTableViewModel = {
  rows: AccountRowViewModel[];
  showEmptyState: boolean;
  emptyStateMessage: string;
};

export type ProviderInfo = {
  id: string;
  displayName: string;
  authMethod: string;
};

export type AccountTableInput = {
  accounts: AccountListItem[];
  providers: ProviderInfo[];
};

export type ConnectFormFieldMeta = {
  name: ConnectFormFieldName;
  label: string;
  placeholder: string;
  inputType: string;
};

export type ConnectFormData = {
  authMethod: string;
  apiKey: string;
  bearerToken: string;
  username: string;
  password: string;
};

export type ConnectFormFieldName = "apiKey" | "bearerToken" | "username" | "password";

export type ConnectValidationResult = {
  isValid: boolean;
  errors: Partial<Record<ConnectFormFieldName, string>>;
};

export type RevokeConfirmationViewModel = {
  title: string;
  warning: string;
  isDestructive: boolean;
};

export type OAuth2ConnectViewModel = {
  providerName: string;
  scopes: string[];
  continueButtonText: string;
  securityExplanation: string;
};

// ---------------------------------------------------------------------------
// Status badge mapping
// ---------------------------------------------------------------------------

const STATUS_BADGES: Record<string, StatusBadge> = {
  active: { label: "Active", variant: "default" },
  revoked: { label: "Revoked", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
};

export function deriveStatusBadge(status: string): StatusBadge {
  return STATUS_BADGES[status] ?? { label: status, variant: "outline" };
}

// ---------------------------------------------------------------------------
// Account action mapping
// ---------------------------------------------------------------------------

export function deriveAccountAction(status: string): AccountAction {
  if (status === "active") {
    return { label: "Revoke", kind: "revoke" };
  }
  return { label: "Reconnect", kind: "reconnect" };
}

// ---------------------------------------------------------------------------
// Account table view model
// ---------------------------------------------------------------------------

function findProviderInfo(
  providerId: string,
  providers: ProviderInfo[],
): ProviderInfo {
  return (
    providers.find((p) => p.id === providerId) ?? {
      id: providerId,
      displayName: "Unknown Provider",
      authMethod: "api_key",
    }
  );
}

function toAccountRow(
  account: AccountListItem,
  providers: ProviderInfo[],
): AccountRowViewModel {
  const provider = findProviderInfo(account.provider_id, providers);
  return {
    id: account.id,
    providerId: account.provider_id,
    providerDisplayName: provider.displayName,
    statusBadge: deriveStatusBadge(account.status),
    action: deriveAccountAction(account.status),
    connectedAt: account.connected_at,
    authMethod: provider.authMethod,
  };
}

const EMPTY_STATE_MESSAGE =
  "No connected accounts. Visit the Providers tab to configure a provider first.";

export function deriveAccountTableViewModel(
  input: AccountTableInput,
): AccountTableViewModel {
  const rows = input.accounts.map((account) =>
    toAccountRow(account, input.providers),
  );
  return {
    rows,
    showEmptyState: rows.length === 0,
    emptyStateMessage: EMPTY_STATE_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Connect form: adaptive fields per auth_method
// ---------------------------------------------------------------------------

const API_KEY_FIELDS: ConnectFormFieldMeta[] = [
  { name: "apiKey", label: "API Key", placeholder: "Enter your API key", inputType: "password" },
];

const BEARER_FIELDS: ConnectFormFieldMeta[] = [
  {
    name: "bearerToken",
    label: "Bearer Token",
    placeholder: "Enter your bearer token",
    inputType: "password",
  },
];

const BASIC_FIELDS: ConnectFormFieldMeta[] = [
  { name: "username", label: "Username", placeholder: "Enter username", inputType: "text" },
  { name: "password", label: "Password", placeholder: "Enter password", inputType: "password" },
];

export function deriveConnectFormFields(authMethod: string): ConnectFormFieldMeta[] {
  switch (authMethod) {
    case "api_key":
      return API_KEY_FIELDS;
    case "bearer":
      return BEARER_FIELDS;
    case "basic":
      return BASIC_FIELDS;
    case "oauth2":
      return [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Connect form: validation
// ---------------------------------------------------------------------------

type ValidationRule = {
  field: ConnectFormFieldName;
  message: string;
};

function requiredFieldsForConnect(authMethod: string): ValidationRule[] {
  switch (authMethod) {
    case "api_key":
      return [{ field: "apiKey", message: "API key is required" }];
    case "bearer":
      return [{ field: "bearerToken", message: "Bearer token is required" }];
    case "basic":
      return [
        { field: "username", message: "Username is required" },
        { field: "password", message: "Password is required" },
      ];
    case "oauth2":
      return [];
    default:
      return [];
  }
}

export function validateConnectForm(formData: ConnectFormData): ConnectValidationResult {
  const rules = requiredFieldsForConnect(formData.authMethod);
  const errors: Partial<Record<ConnectFormFieldName, string>> = {};

  for (const rule of rules) {
    const value = formData[rule.field];
    if (typeof value === "string" && value.trim() === "") {
      errors[rule.field] = rule.message;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// OAuth2 connect view model
// ---------------------------------------------------------------------------

export function deriveOAuth2ConnectViewModel(
  providerName: string,
  scopesString: string,
): OAuth2ConnectViewModel {
  const scopes = scopesString
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    providerName,
    scopes,
    continueButtonText: `Continue to ${providerName}`,
    securityExplanation:
      "You will be redirected to the provider to authorize access. Your credentials are never stored by Brain.",
  };
}

// ---------------------------------------------------------------------------
// Revoke confirmation view model
// ---------------------------------------------------------------------------

export function deriveRevokeConfirmationViewModel(
  providerName: string,
): RevokeConfirmationViewModel {
  return {
    title: `Revoke ${providerName}?`,
    warning:
      "This will permanently delete the stored credentials. You will need to reconnect to use this account again.",
    isDestructive: true,
  };
}

// ---------------------------------------------------------------------------
// React: Revoke confirmation dialog
// ---------------------------------------------------------------------------

type RevokeAccountDialogProps = {
  providerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function RevokeAccountDialog({
  providerName,
  open,
  onOpenChange,
  onConfirm,
}: RevokeAccountDialogProps) {
  const vm = deriveRevokeConfirmationViewModel(providerName);

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
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// React: Account table component
// ---------------------------------------------------------------------------

type AccountTableProps = {
  accounts: AccountListItem[];
  providers: ProviderInfo[];
  onRevoke: (accountId: string) => void;
  onReconnect: (accountId: string, authMethod: string) => void;
};

export function AccountTable({
  accounts,
  providers,
  onRevoke,
  onReconnect,
}: AccountTableProps) {
  const vm = deriveAccountTableViewModel({ accounts, providers });
  const [revokeTarget, setRevokeTarget] = useState<AccountRowViewModel | undefined>();

  const handleActionClick = useCallback(
    (row: AccountRowViewModel) => {
      if (row.action.kind === "revoke") {
        setRevokeTarget(row);
      } else {
        onReconnect(row.id, row.authMethod);
      }
    },
    [onReconnect],
  );

  const handleRevokeConfirm = useCallback(() => {
    if (!revokeTarget) return;
    onRevoke(revokeTarget.id);
    setRevokeTarget(undefined);
  }, [revokeTarget, onRevoke]);

  const handleRevokeCancel = useCallback(() => {
    setRevokeTarget(undefined);
  }, []);

  if (vm.showEmptyState) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{vm.emptyStateMessage}</p>
      </div>
    );
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Provider</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Connected</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {vm.rows.map((row) => (
            <tr key={row.id} className="border-b">
              <td className="px-3 py-2 font-medium">{row.providerDisplayName}</td>
              <td className="px-3 py-2">
                <Badge variant={row.statusBadge.variant}>{row.statusBadge.label}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(row.connectedAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2">
                <Button
                  variant={row.action.kind === "revoke" ? "ghost" : "outline"}
                  size="sm"
                  onClick={() => handleActionClick(row)}
                  className={row.action.kind === "revoke" ? "text-destructive" : ""}
                >
                  {row.action.label}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {revokeTarget && (
        <RevokeAccountDialog
          providerName={revokeTarget.providerDisplayName}
          open={!!revokeTarget}
          onOpenChange={(open) => {
            if (!open) handleRevokeCancel();
          }}
          onConfirm={handleRevokeConfirm}
        />
      )}
    </>
  );
}
