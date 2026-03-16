import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { type PolicyListItem, type PolicyStatus, usePolicies } from "../../hooks/use-policies";
import { CreatePolicyDialog } from "./CreatePolicyDialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

const ALL_STATUSES: PolicyStatus[] = ["draft", "testing", "active", "deprecated", "superseded"];

const STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: "Draft",
  testing: "Testing",
  active: "Active",
  deprecated: "Deprecated",
  superseded: "Superseded",
};

const STATUS_VARIANT: Record<PolicyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  testing: "outline",
  active: "default",
  deprecated: "secondary",
  superseded: "secondary",
};

/** Pure: format ISO date string into a readable short date. */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PolicyTable({ policies }: { policies: PolicyListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted text-muted-foreground">
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Version</th>
            <th className="px-3 py-2 font-medium">Rules</th>
            <th className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.id} className="border-b border-border transition-colors hover:bg-hover">
              <td className="px-3 py-2">
                <Link
                  to="/policies/$policyId"
                  params={{ policyId: policy.id }}
                  className="font-medium text-ring hover:underline"
                >
                  {policy.title}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_VARIANT[policy.status]}>
                  {STATUS_LABELS[policy.status]}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">v{policy.version}</td>
              <td className="px-3 py-2 text-muted-foreground">{policy.rules_count}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDate(policy.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      {hasFilter
        ? "No policies match the selected filter."
        : "No policies yet. Create one to get started."}
    </div>
  );
}

function StatusFilter({
  selectedStatus,
  onStatusChange,
}: {
  selectedStatus?: PolicyStatus;
  onStatusChange: (status?: PolicyStatus) => void;
}) {
  return (
    <div className="flex gap-2 py-2">
      <select
        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none"
        value={selectedStatus ?? ""}
        onChange={(e) =>
          onStatusChange(e.target.value ? (e.target.value as PolicyStatus) : undefined)
        }
      >
        <option value="">All statuses</option>
        {ALL_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PoliciesPage() {
  const { policies, isLoading, error, filters, setFilters } = usePolicies();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleStatusChange = useCallback(
    (status?: PolicyStatus) => {
      setFilters({ ...filters, status });
    },
    [filters, setFilters],
  );

  const handleOpenDialog = useCallback(() => setDialogOpen(true), []);
  const handleCloseDialog = useCallback(() => setDialogOpen(false), []);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Policies</h1>
        <Button size="sm" onClick={handleOpenDialog}>
          Create Policy
        </Button>
      </div>

      <CreatePolicyDialog open={dialogOpen} onClose={handleCloseDialog} />

      <StatusFilter
        selectedStatus={filters.status}
        onStatusChange={handleStatusChange}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading policies...</p>
      ) : policies.length > 0 ? (
        <PolicyTable policies={policies} />
      ) : (
        <EmptyState hasFilter={filters.status !== undefined} />
      )}
    </section>
  );
}
