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
import type { ProviderListItem } from "../../hooks/use-providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthMethod = "oauth2" | "api_key";

export type AuthMethodBadge = {
  label: string;
  variant: "default" | "secondary" | "outline";
};

export type ProviderRowViewModel = {
  id: string;
  name: string;
  displayName: string;
  authMethodBadge: AuthMethodBadge;
  hasClientSecret: boolean;
  createdAt: string;
};

export type ProviderTableViewModel = {
  rows: ProviderRowViewModel[];
  showEmptyState: boolean;
  emptyStateMessage: string;
};

export type ProviderTableInput = {
  providers: ProviderListItem[];
};

export type CreateProviderFormData = {
  name: string;
  display_name: string;
  auth_method: AuthMethod;
  authorization_url: string;
  token_url: string;
  client_id: string;
  client_secret: string;
  scopes: string;
};

export type CreateProviderFieldName = keyof CreateProviderFormData;

export type ValidationResult = {
  isValid: boolean;
  errors: Partial<Record<CreateProviderFieldName, string>>;
};

export type DeleteConfirmationViewModel = {
  title: string;
  warning: string;
  isDestructive: boolean;
};

// ---------------------------------------------------------------------------
// Auth method badge mapping
// ---------------------------------------------------------------------------

const AUTH_METHOD_BADGES: Record<string, AuthMethodBadge> = {
  oauth2: { label: "OAuth2", variant: "default" },
  api_key: { label: "API Key", variant: "secondary" },
};

export function deriveAuthMethodBadge(authMethod: string): AuthMethodBadge {
  return AUTH_METHOD_BADGES[authMethod] ?? { label: authMethod, variant: "outline" };
}

// ---------------------------------------------------------------------------
// Provider table view model
// ---------------------------------------------------------------------------

function toProviderRow(provider: ProviderListItem): ProviderRowViewModel {
  return {
    id: provider.id,
    name: provider.name,
    displayName: provider.display_name,
    authMethodBadge: deriveAuthMethodBadge(provider.auth_method),
    hasClientSecret: provider.has_client_secret,
    createdAt: provider.created_at,
  };
}

const EMPTY_STATE_MESSAGE =
  "No credential providers configured. Add a provider to connect external services.";

export function deriveProviderTableViewModel(
  input: ProviderTableInput,
): ProviderTableViewModel {
  const rows = input.providers.map(toProviderRow);
  return {
    rows,
    showEmptyState: rows.length === 0,
    emptyStateMessage: EMPTY_STATE_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Create provider form: adaptive fields
// ---------------------------------------------------------------------------

const BASE_FIELDS: CreateProviderFieldName[] = ["name", "display_name"];

const OAUTH2_FIELDS: CreateProviderFieldName[] = [
  ...BASE_FIELDS,
  "authorization_url",
  "token_url",
  "client_id",
  "client_secret",
  "scopes",
];

export function deriveCreateProviderFormFields(
  authMethod: AuthMethod,
): CreateProviderFieldName[] {
  return authMethod === "oauth2" ? OAUTH2_FIELDS : BASE_FIELDS;
}

// ---------------------------------------------------------------------------
// Create provider form: validation
// ---------------------------------------------------------------------------

const REQUIRED_BASE_FIELDS: CreateProviderFieldName[] = ["name"];

const REQUIRED_OAUTH2_FIELDS: CreateProviderFieldName[] = [
  "name",
  "authorization_url",
  "token_url",
  "client_id",
];

function requiredFieldsForAuthMethod(authMethod: AuthMethod): CreateProviderFieldName[] {
  return authMethod === "oauth2" ? REQUIRED_OAUTH2_FIELDS : REQUIRED_BASE_FIELDS;
}

export function validateCreateProviderForm(
  formData: CreateProviderFormData,
): ValidationResult {
  const requiredFields = requiredFieldsForAuthMethod(formData.auth_method);
  const errors: Partial<Record<CreateProviderFieldName, string>> = {};

  for (const field of requiredFields) {
    const value = formData[field];
    if (typeof value === "string" && value.trim() === "") {
      errors[field] = `${field} is required`;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Delete confirmation view model
// ---------------------------------------------------------------------------

function formatAccountWarning(activeAccountCount: number): string {
  if (activeAccountCount === 0) return "This action cannot be undone.";
  const noun = activeAccountCount === 1 ? "account" : "accounts";
  return `This provider has ${activeAccountCount} ${noun} that will be disconnected. This action cannot be undone.`;
}

export function deriveDeleteConfirmationViewModel(
  providerName: string,
  activeAccountCount: number,
): DeleteConfirmationViewModel {
  return {
    title: `Delete ${providerName}?`,
    warning: formatAccountWarning(activeAccountCount),
    isDestructive: true,
  };
}

// ---------------------------------------------------------------------------
// React: Delete confirmation dialog
// ---------------------------------------------------------------------------

type DeleteProviderDialogProps = {
  providerName: string;
  activeAccountCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function DeleteProviderDialog({
  providerName,
  activeAccountCount,
  open,
  onOpenChange,
  onConfirm,
}: DeleteProviderDialogProps) {
  const vm = deriveDeleteConfirmationViewModel(providerName, activeAccountCount);

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
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// React: Provider table component
// ---------------------------------------------------------------------------

type ProviderTableProps = {
  providers: ProviderListItem[];
  onDelete: (providerId: string) => void;
};

export function ProviderTable({ providers, onDelete }: ProviderTableProps) {
  const vm = deriveProviderTableViewModel({ providers });
  const [deleteTarget, setDeleteTarget] = useState<ProviderRowViewModel | undefined>();

  const handleDeleteClick = useCallback((row: ProviderRowViewModel) => {
    setDeleteTarget(row);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    onDelete(deleteTarget.id);
    setDeleteTarget(undefined);
  }, [deleteTarget, onDelete]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(undefined);
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
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Display Name</th>
            <th className="px-3 py-2 font-medium">Auth Method</th>
            <th className="px-3 py-2 font-medium">Secret</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {vm.rows.map((row) => (
            <tr key={row.id} className="border-b">
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2">{row.displayName}</td>
              <td className="px-3 py-2">
                <Badge variant={row.authMethodBadge.variant}>
                  {row.authMethodBadge.label}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {row.hasClientSecret ? (
                  <span className="text-green-600">Yes</span>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(row.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteClick(row)}
                  className="text-destructive"
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {deleteTarget && (
        <DeleteProviderDialog
          providerName={deleteTarget.displayName}
          activeAccountCount={0}
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) handleDeleteCancel();
          }}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </>
  );
}
