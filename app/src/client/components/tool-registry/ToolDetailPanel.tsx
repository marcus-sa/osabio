import { useToolDetail } from "../../hooks/use-tool-detail";
import { Button } from "../ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GrantDetail = {
  identity_id: string;
  identity_name: string;
  max_calls_per_hour?: number;
  granted_at: string;
};

export type GovernancePolicyDetail = {
  policy_title: string;
  policy_status: string;
  conditions?: string;
  max_per_call?: number;
  max_per_day?: number;
};

export type ToolDetailData = {
  id: string;
  name: string;
  toolkit: string;
  description: string;
  risk_level: string;
  status: string;
  grant_count: number;
  governance_count: number;
  created_at: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  grants: GrantDetail[];
  governance_policies: GovernancePolicyDetail[];
};

export type ToolDetailViewState =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "loaded"; data: ToolDetailData };

// ---------------------------------------------------------------------------
// View model types
// ---------------------------------------------------------------------------

export type GrantRowViewModel = {
  identityId: string;
  identityName: string;
  rateLimitDisplay: string;
  grantedAt: string;
};

export type GovernanceRowViewModel = {
  policyTitle: string;
  conditionsDisplay: string;
  maxPerCallDisplay: string;
  maxPerDayDisplay: string;
};

export type ToolDetailViewModel =
  | { tag: "loading" }
  | { tag: "error"; errorMessage: string }
  | {
      tag: "loaded";
      formattedInputSchema: string;
      formattedOutputSchema?: string;
      grantRows: GrantRowViewModel[];
      governanceRows: GovernanceRowViewModel[];
      showEmptyGrants: boolean;
      showEmptyGovernance: boolean;
    };

// ---------------------------------------------------------------------------
// Grant row derivation
// ---------------------------------------------------------------------------

function formatRateLimit(maxCallsPerHour?: number): string {
  if (maxCallsPerHour === undefined) return "Unlimited";
  return `${maxCallsPerHour}/hr`;
}

function toGrantRow(grant: GrantDetail): GrantRowViewModel {
  return {
    identityId: grant.identity_id,
    identityName: grant.identity_name,
    rateLimitDisplay: formatRateLimit(grant.max_calls_per_hour),
    grantedAt: grant.granted_at,
  };
}

// ---------------------------------------------------------------------------
// Governance row derivation
// ---------------------------------------------------------------------------

function formatOptionalNumber(value?: number): string {
  if (value === undefined) return "--";
  return String(value);
}

function toGovernanceRow(policy: GovernancePolicyDetail): GovernanceRowViewModel {
  return {
    policyTitle: policy.policy_title,
    conditionsDisplay: policy.conditions ?? "None",
    maxPerCallDisplay: formatOptionalNumber(policy.max_per_call),
    maxPerDayDisplay: formatOptionalNumber(policy.max_per_day),
  };
}

// ---------------------------------------------------------------------------
// View model derivation
// ---------------------------------------------------------------------------

export function deriveToolDetailViewModel(
  viewState: ToolDetailViewState,
): ToolDetailViewModel {
  if (viewState.state === "loading") {
    return { tag: "loading" };
  }

  if (viewState.state === "error") {
    return { tag: "error", errorMessage: viewState.error };
  }

  const { data } = viewState;
  const grantRows = data.grants.map(toGrantRow);
  const governanceRows = data.governance_policies.map(toGovernanceRow);

  return {
    tag: "loaded",
    formattedInputSchema: JSON.stringify(data.input_schema, null, 2),
    formattedOutputSchema: data.output_schema
      ? JSON.stringify(data.output_schema, null, 2)
      : undefined,
    grantRows,
    governanceRows,
    showEmptyGrants: grantRows.length === 0,
    showEmptyGovernance: governanceRows.length === 0,
  };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export type ToolDetailActions = {
  onGrantAccess?: (toolId: string) => void;
  onRevokeGrant?: (toolId: string, identityId: string) => void;
};

type ToolDetailPanelProps = {
  toolId: string;
  toolName?: string;
  actions?: ToolDetailActions;
};

export function ToolDetailPanel({ toolId, actions }: ToolDetailPanelProps) {
  const { data, isLoading, error } = useToolDetail(toolId);

  const viewState: ToolDetailViewState = isLoading
    ? { state: "loading" }
    : error
      ? { state: "error", error }
      : data
        ? { state: "loaded", data }
        : { state: "loading" };

  const vm = deriveToolDetailViewModel(viewState);

  if (vm.tag === "loading") {
    return (
      <tr>
        <td colSpan={6} className="px-6 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="animate-spin">&#x23F3;</span>
            Loading tool details...
          </div>
        </td>
      </tr>
    );
  }

  if (vm.tag === "error") {
    return (
      <tr>
        <td colSpan={6} className="px-6 py-4">
          <div className="text-sm text-red-600">{vm.errorMessage}</div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={6} className="bg-muted/30 px-6 py-4">
        <div className="flex flex-col gap-4">
          {/* Input Schema */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Input Schema
            </h4>
            <pre className="overflow-auto rounded bg-muted p-3 text-xs">
              {vm.formattedInputSchema}
            </pre>
          </div>

          {/* Output Schema */}
          {vm.formattedOutputSchema && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Output Schema
              </h4>
              <pre className="overflow-auto rounded bg-muted p-3 text-xs">
                {vm.formattedOutputSchema}
              </pre>
            </div>
          )}

          {/* Grants */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Grants
              </h4>
              {actions?.onGrantAccess && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.onGrantAccess!(toolId)}
                >
                  Grant Access
                </Button>
              )}
            </div>
            {vm.showEmptyGrants ? (
              <p className="text-sm text-muted-foreground">No grants configured.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1 font-medium">Identity</th>
                    <th className="px-2 py-1 font-medium">Rate Limit</th>
                    <th className="px-2 py-1 font-medium">Granted At</th>
                    {actions?.onRevokeGrant && (
                      <th className="px-2 py-1 font-medium" />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {vm.grantRows.map((grant) => (
                    <tr key={grant.identityId} className="border-b">
                      <td className="px-2 py-1">{grant.identityName}</td>
                      <td className="px-2 py-1">{grant.rateLimitDisplay}</td>
                      <td className="px-2 py-1">{grant.grantedAt}</td>
                      {actions?.onRevokeGrant && (
                        <td className="px-2 py-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => actions.onRevokeGrant!(toolId, grant.identityId)}
                          >
                            Revoke
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Governance */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Governance Policies
            </h4>
            {vm.showEmptyGovernance ? (
              <p className="text-sm text-muted-foreground">No governance policies attached.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1 font-medium">Policy</th>
                    <th className="px-2 py-1 font-medium">Conditions</th>
                    <th className="px-2 py-1 font-medium">Max/Call</th>
                    <th className="px-2 py-1 font-medium">Max/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.governanceRows.map((policy) => (
                    <tr key={policy.policyTitle} className="border-b">
                      <td className="px-2 py-1">{policy.policyTitle}</td>
                      <td className="px-2 py-1">{policy.conditionsDisplay}</td>
                      <td className="px-2 py-1">{policy.maxPerCallDisplay}</td>
                      <td className="px-2 py-1">{policy.maxPerDayDisplay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
