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
import type { ToolListItem } from "../../hooks/use-tools";
import type { GrantListItem } from "../../hooks/use-grants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GrantToolRowViewModel = {
  toolId: string;
  toolName: string;
  grantCountDisplay: string;
  grantCount: number;
};

export type GrantRowViewModel = {
  identityName: string;
  identityId: string;
  rateLimitDisplay: string;
  grantedAtDisplay: string;
  sourceDisplay: string;
};

export type GrantTableViewModel = {
  rows: GrantToolRowViewModel[];
  showEmptyState: boolean;
  emptyStateMessage: string;
};

export type GrantTableInput = {
  tools: ToolListItem[];
};

export type CreateGrantFormData = {
  identity_id: string;
  max_calls_per_hour?: number;
};

export type CreateGrantFieldName = keyof CreateGrantFormData;

export type GrantValidationResult = {
  isValid: boolean;
  errors: Partial<Record<CreateGrantFieldName, string>>;
};

export type RevokeConfirmationViewModel = {
  title: string;
  warning: string;
  isDestructive: boolean;
};

// ---------------------------------------------------------------------------
// Grant table view model
// ---------------------------------------------------------------------------

function toGrantToolRow(tool: ToolListItem): GrantToolRowViewModel {
  return {
    toolId: tool.id,
    toolName: tool.name,
    grantCountDisplay: String(tool.grant_count),
    grantCount: tool.grant_count,
  };
}

const EMPTY_STATE_MESSAGE =
  "No tools available to grant access. Discover tools first, then manage access here.";

export function deriveGrantTableViewModel(
  input: GrantTableInput,
): GrantTableViewModel {
  const rows = input.tools.map(toGrantToolRow);
  return {
    rows,
    showEmptyState: rows.length === 0,
    emptyStateMessage: EMPTY_STATE_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Grant row view model
// ---------------------------------------------------------------------------

function formatRateLimit(maxCallsPerHour?: number): string {
  if (maxCallsPerHour === undefined) return "Unlimited";
  return `${maxCallsPerHour}/hr`;
}

export function deriveGrantRowViewModel(grant: GrantListItem): GrantRowViewModel {
  return {
    identityName: grant.identity_name,
    identityId: grant.identity_id,
    rateLimitDisplay: formatRateLimit(grant.max_calls_per_hour),
    grantedAtDisplay: grant.granted_at,
    sourceDisplay: "direct",
  };
}

// ---------------------------------------------------------------------------
// Create grant form validation
// ---------------------------------------------------------------------------

export function validateCreateGrantForm(
  formData: CreateGrantFormData,
): GrantValidationResult {
  const errors: Partial<Record<CreateGrantFieldName, string>> = {};

  if (!formData.identity_id || formData.identity_id.trim() === "") {
    errors.identity_id = "Identity is required";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Duplicate grant message
// ---------------------------------------------------------------------------

export function deriveDuplicateGrantMessage(
  identityName: string,
  toolName: string,
): string {
  return `${identityName} already has access to ${toolName}.`;
}

// ---------------------------------------------------------------------------
// Revoke confirmation view model
// ---------------------------------------------------------------------------

export function deriveRevokeConfirmationViewModel(
  identityName: string,
  toolName: string,
): RevokeConfirmationViewModel {
  return {
    title: `Revoke access?`,
    warning: `This will remove ${identityName}'s access to ${toolName}. This action cannot be undone.`,
    isDestructive: true,
  };
}

// ---------------------------------------------------------------------------
// Grant count update
// ---------------------------------------------------------------------------

export function deriveUpdatedGrantCount(currentCount: number): number {
  return currentCount + 1;
}

// ---------------------------------------------------------------------------
// React: Revoke confirmation dialog
// ---------------------------------------------------------------------------

type RevokeGrantDialogProps = {
  identityName: string;
  toolName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function RevokeGrantDialog({
  identityName,
  toolName,
  open,
  onOpenChange,
  onConfirm,
}: RevokeGrantDialogProps) {
  const vm = deriveRevokeConfirmationViewModel(identityName, toolName);

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
// React: Grant rows for a single tool
// ---------------------------------------------------------------------------

type GrantRowsProps = {
  grants: GrantListItem[];
  toolName: string;
  onRevoke: (identityId: string) => void;
};

function GrantRows({ grants, toolName, onRevoke }: GrantRowsProps) {
  const [revokeTarget, setRevokeTarget] = useState<GrantRowViewModel | undefined>();
  const rows = grants.map(deriveGrantRowViewModel);

  const handleRevokeConfirm = useCallback(() => {
    if (!revokeTarget) return;
    onRevoke(revokeTarget.identityId);
    setRevokeTarget(undefined);
  }, [revokeTarget, onRevoke]);

  if (rows.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="px-6 py-3 text-sm text-muted-foreground">
          No grants configured. Use "Grant Access" to add identities.
        </td>
      </tr>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.identityId} className="border-b bg-muted/20">
          <td className="px-6 py-2 text-sm">{row.identityName}</td>
          <td className="px-3 py-2 text-sm">{row.sourceDisplay}</td>
          <td className="px-3 py-2 text-sm">{row.rateLimitDisplay}</td>
          <td className="px-3 py-2 text-sm text-muted-foreground">{row.grantedAtDisplay}</td>
          <td className="px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevokeTarget(row)}
              className="text-destructive"
            >
              Revoke
            </Button>
          </td>
        </tr>
      ))}
      {revokeTarget && (
        <RevokeGrantDialog
          identityName={revokeTarget.identityName}
          toolName={toolName}
          open={!!revokeTarget}
          onOpenChange={(open) => {
            if (!open) setRevokeTarget(undefined);
          }}
          onConfirm={handleRevokeConfirm}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// React: Grant table component
// ---------------------------------------------------------------------------

type GrantTableProps = {
  tools: ToolListItem[];
  grantsByToolId: Record<string, GrantListItem[]>;
  onGrantAccess: (toolId: string) => void;
  onRevokeGrant: (toolId: string, identityId: string) => void;
};

export function GrantTable({
  tools,
  grantsByToolId,
  onGrantAccess,
  onRevokeGrant,
}: GrantTableProps) {
  const vm = deriveGrantTableViewModel({ tools });
  const [expandedToolId, setExpandedToolId] = useState<string | undefined>();

  const handleToggle = useCallback((toolId: string) => {
    setExpandedToolId((current) => (current === toolId ? undefined : toolId));
  }, []);

  if (vm.showEmptyState) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{vm.emptyStateMessage}</p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="px-3 py-2 font-medium">Tool</th>
          <th className="px-3 py-2 font-medium">Grants</th>
          <th className="px-3 py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {vm.rows.map((row) => (
          <>
            <tr
              key={row.toolId}
              className="cursor-pointer border-b hover:bg-muted/50"
              onClick={() => handleToggle(row.toolId)}
            >
              <td className="px-3 py-2 font-medium">{row.toolName}</td>
              <td className="px-3 py-2">
                <Badge variant="secondary">{row.grantCountDisplay}</Badge>
              </td>
              <td className="px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGrantAccess(row.toolId);
                  }}
                >
                  Grant Access
                </Button>
              </td>
            </tr>
            {expandedToolId === row.toolId && (
              <GrantRows
                grants={grantsByToolId[row.toolId] ?? []}
                toolName={row.toolName}
                onRevoke={(identityId) => onRevokeGrant(row.toolId, identityId)}
              />
            )}
          </>
        ))}
      </tbody>
    </table>
  );
}
