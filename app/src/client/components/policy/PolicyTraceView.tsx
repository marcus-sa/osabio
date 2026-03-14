/**
 * PolicyTraceView: displays policy evaluation trace entries from intent
 * authorization. Shows which policies and rules matched/unmatched during
 * evaluation, with links to policy detail pages.
 *
 * Pure helpers compute summary stats. Component is reusable -- can be
 * embedded in any review/consent page that has PolicyTraceEntry[] data.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Types (mirroring server PolicyTraceEntry shape)
// ---------------------------------------------------------------------------

export type PolicyTraceEntry = {
  policy_id: string;
  policy_version: number;
  rule_id: string;
  effect: "allow" | "deny";
  matched: boolean;
  priority: number;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

type TraceSummary = {
  totalRules: number;
  matchedRules: number;
  unmatchedRules: number;
  uniquePolicies: number;
};

function computeTraceSummary(entries: PolicyTraceEntry[]): TraceSummary {
  const matched = entries.filter((entry) => entry.matched);
  const policyIds = new Set(entries.map((entry) => entry.policy_id));
  return {
    totalRules: entries.length,
    matchedRules: matched.length,
    unmatchedRules: entries.length - matched.length,
    uniquePolicies: policyIds.size,
  };
}

function sortTraceEntries(entries: PolicyTraceEntry[]): PolicyTraceEntry[] {
  return [...entries].sort((a, b) => {
    // Matched first, then by priority descending
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    return b.priority - a.priority;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PolicyTraceView({
  entries,
}: {
  entries: PolicyTraceEntry[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (entries.length === 0) {
    return (
      <div className="policy-trace">
        <p className="policy-trace__empty">No policy trace available.</p>
      </div>
    );
  }

  const summary = computeTraceSummary(entries);
  const sortedEntries = sortTraceEntries(entries);

  return (
    <div className="policy-trace">
      <button
        type="button"
        className="policy-trace__summary"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <span className="policy-trace__summary-text">
          {summary.totalRules} rules evaluated across {summary.uniquePolicies}{" "}
          {summary.uniquePolicies === 1 ? "policy" : "policies"} --{" "}
          <span className="policy-trace__matched-count">
            {summary.matchedRules} matched
          </span>
          {summary.unmatchedRules > 0 && (
            <span className="policy-trace__unmatched-count">
              , {summary.unmatchedRules} unmatched
            </span>
          )}
        </span>
        <span className="policy-trace__toggle">
          {isExpanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {isExpanded && (
        <div className="policy-trace__detail">
          <table className="policy-trace__table">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Version</th>
                <th>Rule</th>
                <th>Effect</th>
                <th>Matched</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr
                  key={`${entry.policy_id}-${entry.rule_id}`}
                  className={
                    entry.matched
                      ? "policy-trace__row--matched"
                      : "policy-trace__row--unmatched"
                  }
                >
                  <td>
                    <Link
                      to="/policies/$policyId"
                      params={{ policyId: entry.policy_id }}
                      className="policy-trace__policy-link"
                    >
                      {entry.policy_id}
                    </Link>
                  </td>
                  <td>v{entry.policy_version}</td>
                  <td className="policy-trace__rule-id">{entry.rule_id}</td>
                  <td>
                    <span
                      className={`policy-detail__effect-badge policy-detail__effect-badge--${entry.effect}`}
                    >
                      {entry.effect}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`policy-trace__match-indicator policy-trace__match-indicator--${entry.matched ? "yes" : "no"}`}
                    >
                      {entry.matched ? "Yes" : "No"}
                    </span>
                  </td>
                  <td>{entry.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
