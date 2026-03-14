/**
 * Policy detail page: displays full policy record, governance edges,
 * version chain, and lifecycle action buttons (activate/deprecate/create version).
 *
 * Pure helper functions handle formatting and status logic.
 * Side effects (fetch, navigate) are isolated at the component boundary.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useWorkspaceState } from "../../stores/workspace-state";
import type { PolicyStatus } from "../../hooks/use-policies";
import { VersionDiffView } from "./VersionDiffView";

// ---------------------------------------------------------------------------
// API response types (mirroring server shape)
// ---------------------------------------------------------------------------

type PolicyRule = {
  id: string;
  condition: RuleCondition;
  effect: "allow" | "deny";
  priority: number;
};

type RulePredicate = {
  field: string;
  operator: string;
  value: string | number | boolean | string[];
};

type RuleCondition = RulePredicate | RulePredicate[];

type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

type PolicyDetail = {
  id: string;
  title: string;
  description?: string;
  version: number;
  status: PolicyStatus;
  selector: PolicySelector;
  rules: PolicyRule[];
  human_veto_required: boolean;
  max_ttl?: string;
  supersedes?: string;
  created_at: string;
  updated_at?: string;
};

type PolicyEdgeInfo = {
  governing: Array<{ identity_id: string; created_at: string }>;
  protects: Array<{ workspace_id: string; created_at: string }>;
};

type VersionChainItem = {
  id: string;
  version: number;
  status: string;
  created_at: string;
};

type PolicyDetailResponse = {
  policy: PolicyDetail;
  edges: PolicyEdgeInfo;
  version_chain: VersionChainItem[];
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: "Draft",
  testing: "Testing",
  active: "Active",
  deprecated: "Deprecated",
  superseded: "Superseded",
};

function statusBadgeClass(status: PolicyStatus): string {
  return `policies-page__status-badge policies-page__status-badge--${status}`;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Pure: determine whether Activate action is available for a given status. */
function canActivate(status: PolicyStatus): boolean {
  return status === "draft" || status === "testing";
}

/** Pure: determine whether Deprecate action is available for a given status. */
function canDeprecate(status: PolicyStatus): boolean {
  return status === "active";
}

/** Pure: determine whether Create New Version action is available for a given status. */
function canCreateVersion(status: PolicyStatus): boolean {
  return status === "active";
}

/** Pure: format a rule condition into a human-readable string. */
function formatCondition(condition: RuleCondition): string {
  const predicates = Array.isArray(condition) ? condition : [condition];
  return predicates
    .map((predicate) => {
      const valueDisplay = Array.isArray(predicate.value)
        ? `[${predicate.value.join(", ")}]`
        : String(predicate.value);
      return `${predicate.field} ${predicate.operator} ${valueDisplay}`;
    })
    .join(" AND ");
}

/** Pure: build the API URL for a policy detail. */
function buildPolicyDetailUrl(workspaceId: string, policyId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/policies/${encodeURIComponent(policyId)}`;
}

/** Pure: check if selector has any values. */
function hasSelectorValues(selector: PolicySelector): boolean {
  return Boolean(selector.workspace || selector.agent_role || selector.resource);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PolicyMetadata({ policy }: { policy: PolicyDetail }) {
  return (
    <div className="policy-detail__metadata">
      <div className="policy-detail__meta-row">
        <span className="policy-detail__meta-label">Status</span>
        <span className={statusBadgeClass(policy.status)}>
          {STATUS_LABELS[policy.status]}
        </span>
      </div>
      <div className="policy-detail__meta-row">
        <span className="policy-detail__meta-label">Version</span>
        <span className="policy-detail__meta-value">v{policy.version}</span>
      </div>
      <div className="policy-detail__meta-row">
        <span className="policy-detail__meta-label">Created</span>
        <span className="policy-detail__meta-value">
          {formatDateTime(policy.created_at)}
        </span>
      </div>
      {policy.updated_at && (
        <div className="policy-detail__meta-row">
          <span className="policy-detail__meta-label">Updated</span>
          <span className="policy-detail__meta-value">
            {formatDateTime(policy.updated_at)}
          </span>
        </div>
      )}
      <div className="policy-detail__meta-row">
        <span className="policy-detail__meta-label">Human veto</span>
        <span className="policy-detail__meta-value">
          {policy.human_veto_required ? "Required" : "Not required"}
        </span>
      </div>
      {policy.max_ttl && (
        <div className="policy-detail__meta-row">
          <span className="policy-detail__meta-label">Max TTL</span>
          <span className="policy-detail__meta-value">{policy.max_ttl}</span>
        </div>
      )}
      {hasSelectorValues(policy.selector) && (
        <div className="policy-detail__meta-row">
          <span className="policy-detail__meta-label">Selector</span>
          <span className="policy-detail__meta-value policy-detail__meta-value--mono">
            {[
              policy.selector.agent_role && `role: ${policy.selector.agent_role}`,
              policy.selector.workspace && `workspace: ${policy.selector.workspace}`,
              policy.selector.resource && `resource: ${policy.selector.resource}`,
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

function RulesSection({ rules }: { rules: PolicyRule[] }) {
  if (rules.length === 0) {
    return (
      <div className="policy-detail__section">
        <h3 className="policy-detail__section-title">Rules</h3>
        <p className="policy-detail__empty-text">No rules defined.</p>
      </div>
    );
  }

  return (
    <div className="policy-detail__section">
      <h3 className="policy-detail__section-title">
        Rules ({rules.length})
      </h3>
      <div className="policy-detail__rules-table-wrapper">
        <table className="policy-detail__rules-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Condition</th>
              <th>Effect</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="policy-detail__rule-id">{rule.id}</td>
                <td className="policy-detail__rule-condition">
                  {formatCondition(rule.condition)}
                </td>
                <td>
                  <span
                    className={`policy-detail__effect-badge policy-detail__effect-badge--${rule.effect}`}
                  >
                    {rule.effect}
                  </span>
                </td>
                <td>{rule.priority}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GovernanceEdgesSection({ edges }: { edges: PolicyEdgeInfo }) {
  const hasEdges = edges.governing.length > 0 || edges.protects.length > 0;

  return (
    <div className="policy-detail__section">
      <h3 className="policy-detail__section-title">Governance Edges</h3>
      {!hasEdges ? (
        <p className="policy-detail__empty-text">No governance edges.</p>
      ) : (
        <div className="policy-detail__edges">
          {edges.governing.length > 0 && (
            <div className="policy-detail__edge-group">
              <h4 className="policy-detail__edge-group-title">
                Governing Identities
              </h4>
              <ul className="policy-detail__edge-list">
                {edges.governing.map((edge) => (
                  <li key={edge.identity_id} className="policy-detail__edge-item">
                    <span className="policy-detail__edge-id">
                      {edge.identity_id}
                    </span>
                    <span className="policy-detail__edge-date">
                      {formatDate(edge.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {edges.protects.length > 0 && (
            <div className="policy-detail__edge-group">
              <h4 className="policy-detail__edge-group-title">
                Protected Workspaces
              </h4>
              <ul className="policy-detail__edge-list">
                {edges.protects.map((edge) => (
                  <li
                    key={edge.workspace_id}
                    className="policy-detail__edge-item"
                  >
                    <span className="policy-detail__edge-id">
                      {edge.workspace_id}
                    </span>
                    <span className="policy-detail__edge-date">
                      {formatDate(edge.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VersionHistorySection({
  versionChain,
  currentPolicyId,
  onCompare,
}: {
  versionChain: VersionChainItem[];
  currentPolicyId: string;
  onCompare?: (oldVersionId: string, newVersionId: string) => void;
}) {
  if (versionChain.length === 0) {
    return (
      <div className="policy-detail__section">
        <h3 className="policy-detail__section-title">Version History</h3>
        <p className="policy-detail__empty-text">No version history.</p>
      </div>
    );
  }

  return (
    <div className="policy-detail__section">
      <h3 className="policy-detail__section-title">Version History</h3>
      <ul className="policy-detail__version-list">
        {versionChain.map((version, index) => {
          const isCurrent = version.id === currentPolicyId;
          const nextVersion =
            index < versionChain.length - 1
              ? versionChain[index + 1]
              : undefined;
          return (
            <li
              key={version.id}
              className={`policy-detail__version-item${isCurrent ? " policy-detail__version-item--current" : ""}`}
            >
              <div className="policy-detail__version-info">
                {isCurrent ? (
                  <span className="policy-detail__version-label">
                    v{version.version} (current)
                  </span>
                ) : (
                  <Link
                    to="/policies/$policyId"
                    params={{ policyId: version.id }}
                    className="policy-detail__version-link"
                  >
                    v{version.version}
                  </Link>
                )}
                <span
                  className={statusBadgeClass(version.status as PolicyStatus)}
                >
                  {STATUS_LABELS[version.status as PolicyStatus] ??
                    version.status}
                </span>
              </div>
              <div className="policy-detail__version-actions">
                {nextVersion && onCompare && (
                  <button
                    type="button"
                    className="policy-detail__diff-btn"
                    onClick={() => onCompare(nextVersion.id, version.id)}
                    title={`Compare v${nextVersion.version} with v${version.version}`}
                  >
                    Diff v{nextVersion.version}
                  </button>
                )}
                <span className="policy-detail__version-date">
                  {formatDate(version.created_at)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  isDestructive,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  isDestructive?: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="policy-dialog__backdrop" onClick={onCancel}>
      <div
        className="policy-detail__confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="policy-detail__confirm-title">{title}</h3>
        <p className="policy-detail__confirm-message">{message}</p>
        <div className="policy-detail__confirm-actions">
          <button
            type="button"
            className="policy-dialog__cancel-btn"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`policy-detail__confirm-btn${isDestructive ? " policy-detail__confirm-btn--destructive" : ""}`}
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

type LifecycleAction = "activate" | "deprecate" | "create_version";

function ActionButtons({
  policy,
  onAction,
}: {
  policy: PolicyDetail;
  onAction: (action: LifecycleAction) => void;
}) {
  const showActivate = canActivate(policy.status);
  const showDeprecate = canDeprecate(policy.status);
  const showCreateVersion = canCreateVersion(policy.status);

  if (!showActivate && !showDeprecate && !showCreateVersion) {
    return undefined;
  }

  return (
    <div className="policy-detail__actions">
      {showActivate && (
        <button
          type="button"
          className="policy-detail__action-btn policy-detail__action-btn--activate"
          onClick={() => onAction("activate")}
        >
          Activate
        </button>
      )}
      {showDeprecate && (
        <button
          type="button"
          className="policy-detail__action-btn policy-detail__action-btn--deprecate"
          onClick={() => onAction("deprecate")}
        >
          Deprecate
        </button>
      )}
      {showCreateVersion && (
        <button
          type="button"
          className="policy-detail__action-btn policy-detail__action-btn--version"
          onClick={() => onAction("create_version")}
        >
          Create New Version
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PolicyDetailPage() {
  const { policyId } = useParams({ strict: false }) as { policyId: string };
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const navigate = useNavigate();

  const [data, setData] = useState<PolicyDetailResponse | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmAction, setConfirmAction] = useState<
    LifecycleAction | undefined
  >();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [diffPair, setDiffPair] = useState<
    { oldPolicy: PolicyDetail; newPolicy: PolicyDetail } | undefined
  >();
  const [isDiffLoading, setIsDiffLoading] = useState(false);

  const fetchPolicy = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    setError(undefined);

    try {
      const url = buildPolicyDetailUrl(workspaceId, policyId);
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to load policy (${response.status})`);
      }
      const result = (await response.json()) as PolicyDetailResponse;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policy");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, policyId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchPolicy();
  }, [workspaceId, policyId, fetchPolicy]);

  const handleAction = useCallback((action: LifecycleAction) => {
    setConfirmAction(action);
    setActionError(undefined);
  }, []);

  const handleCancelAction = useCallback(() => {
    if (isSubmitting) return;
    setConfirmAction(undefined);
    setActionError(undefined);
  }, [isSubmitting]);

  const handleConfirmAction = useCallback(async () => {
    if (!workspaceId || !confirmAction) return;

    setIsSubmitting(true);
    setActionError(undefined);

    try {
      const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/policies/${encodeURIComponent(policyId)}`;

      if (confirmAction === "activate") {
        const response = await fetch(`${base}/activate`, { method: "PATCH" });
        if (!response.ok) {
          const body = await response.text();
          let message: string;
          try {
            const parsed = JSON.parse(body) as { error?: string };
            message = parsed.error ?? body;
          } catch {
            message = body;
          }
          throw new Error(message || "Failed to activate policy");
        }
        setConfirmAction(undefined);
        void fetchPolicy();
      } else if (confirmAction === "deprecate") {
        const response = await fetch(`${base}/deprecate`, { method: "PATCH" });
        if (!response.ok) {
          const body = await response.text();
          let message: string;
          try {
            const parsed = JSON.parse(body) as { error?: string };
            message = parsed.error ?? body;
          } catch {
            message = body;
          }
          throw new Error(message || "Failed to deprecate policy");
        }
        setConfirmAction(undefined);
        void fetchPolicy();
      } else if (confirmAction === "create_version") {
        const response = await fetch(`${base}/versions`, { method: "POST" });
        if (!response.ok) {
          const body = await response.text();
          let message: string;
          try {
            const parsed = JSON.parse(body) as { error?: string };
            message = parsed.error ?? body;
          } catch {
            message = body;
          }
          throw new Error(message || "Failed to create new version");
        }
        const result = (await response.json()) as { policy_id: string };
        setConfirmAction(undefined);
        void navigate({
          to: "/policies/$policyId",
          params: { policyId: result.policy_id },
        });
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Action failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [workspaceId, policyId, confirmAction, fetchPolicy, navigate]);

  const handleCompareVersions = useCallback(
    async (oldVersionId: string, newVersionId: string) => {
      if (!workspaceId) return;
      setIsDiffLoading(true);
      try {
        const [oldRes, newRes] = await Promise.all([
          fetch(buildPolicyDetailUrl(workspaceId, oldVersionId)),
          fetch(buildPolicyDetailUrl(workspaceId, newVersionId)),
        ]);
        if (!oldRes.ok || !newRes.ok) {
          throw new Error("Failed to fetch version details for comparison");
        }
        const oldData = (await oldRes.json()) as PolicyDetailResponse;
        const newData = (await newRes.json()) as PolicyDetailResponse;
        setDiffPair({
          oldPolicy: oldData.policy,
          newPolicy: newData.policy,
        });
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to load diff",
        );
      } finally {
        setIsDiffLoading(false);
      }
    },
    [workspaceId],
  );

  // Confirmation dialog config per action type
  const confirmConfig: Record<
    LifecycleAction,
    { title: string; message: string; confirmLabel: string; isDestructive?: boolean }
  > = {
    activate: {
      title: "Activate Policy",
      message:
        "Activating this policy will make it enforceable in the governance pipeline. Are you sure?",
      confirmLabel: "Activate",
    },
    deprecate: {
      title: "Deprecate Policy",
      message:
        "Deprecating this policy will remove it from active enforcement. This action cannot be undone. Are you sure?",
      confirmLabel: "Deprecate",
      isDestructive: true,
    },
    create_version: {
      title: "Create New Version",
      message:
        "This will create a new draft version based on the current policy. The current version remains active until the new version is activated.",
      confirmLabel: "Create Version",
    },
  };

  return (
    <section className="policy-detail">
      <div className="policy-detail__back">
        <Link to="/policies" className="policy-detail__back-link">
          Back to Policies
        </Link>
      </div>

      {error && <p className="policy-detail__error">{error}</p>}

      {isLoading ? (
        <p className="policy-detail__loading">Loading policy...</p>
      ) : data ? (
        <>
          <div className="policy-detail__header">
            <div className="policy-detail__header-text">
              <h1 className="policy-detail__title">{data.policy.title}</h1>
              {data.policy.description && (
                <p className="policy-detail__description">
                  {data.policy.description}
                </p>
              )}
            </div>
            <ActionButtons policy={data.policy} onAction={handleAction} />
          </div>

          {actionError && (
            <p className="policy-detail__error">{actionError}</p>
          )}

          <PolicyMetadata policy={data.policy} />
          <RulesSection rules={data.policy.rules} />
          <GovernanceEdgesSection edges={data.edges} />
          <VersionHistorySection
            versionChain={data.version_chain}
            currentPolicyId={data.policy.id}
            onCompare={handleCompareVersions}
          />

          {isDiffLoading && (
            <p className="policy-detail__loading">Loading diff...</p>
          )}

          {diffPair && (
            <VersionDiffView
              oldPolicy={diffPair.oldPolicy}
              newPolicy={diffPair.newPolicy}
              onClose={() => setDiffPair(undefined)}
            />
          )}

          {confirmAction && (
            <ConfirmDialog
              {...confirmConfig[confirmAction]}
              isSubmitting={isSubmitting}
              onConfirm={handleConfirmAction}
              onCancel={handleCancelAction}
            />
          )}
        </>
      ) : undefined}
    </section>
  );
}
