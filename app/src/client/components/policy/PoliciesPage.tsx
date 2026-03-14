import { useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { type PolicyListItem, type PolicyStatus, usePolicies } from "../../hooks/use-policies";

const ALL_STATUSES: PolicyStatus[] = ["draft", "testing", "active", "deprecated", "superseded"];

const STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: "Draft",
  testing: "Testing",
  active: "Active",
  deprecated: "Deprecated",
  superseded: "Superseded",
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

/** Pure: compute a CSS modifier class for a policy status badge. */
function statusBadgeClass(status: PolicyStatus): string {
  return `policies-page__status-badge policies-page__status-badge--${status}`;
}

function PolicyTable({ policies }: { policies: PolicyListItem[] }) {
  return (
    <div className="policies-page__table-wrapper">
      <table className="policies-page__table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Version</th>
            <th>Rules</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.id} className="policies-page__row">
              <td>
                <Link
                  to="/policies/$policyId"
                  params={{ policyId: policy.id }}
                  className="policies-page__title-link"
                >
                  {policy.title}
                </Link>
              </td>
              <td>
                <span className={statusBadgeClass(policy.status)}>
                  {STATUS_LABELS[policy.status]}
                </span>
              </td>
              <td>v{policy.version}</td>
              <td>{policy.rules_count}</td>
              <td>{formatDate(policy.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="policies-page__empty">
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
    <div className="policies-page__filters">
      <select
        className="policies-page__status-select"
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

  const handleStatusChange = useCallback(
    (status?: PolicyStatus) => {
      setFilters({ ...filters, status });
    },
    [filters, setFilters],
  );

  return (
    <section className="policies-page">
      <div className="policies-page__header">
        <h1>Policies</h1>
        <button type="button" className="policies-page__create-btn" disabled>
          Create Policy
        </button>
      </div>

      <StatusFilter
        selectedStatus={filters.status}
        onStatusChange={handleStatusChange}
      />

      {error && <p className="policies-page__error">{error}</p>}

      {isLoading ? (
        <p className="policies-page__loading">Loading policies...</p>
      ) : policies.length > 0 ? (
        <PolicyTable policies={policies} />
      ) : (
        <EmptyState hasFilter={filters.status !== undefined} />
      )}
    </section>
  );
}
