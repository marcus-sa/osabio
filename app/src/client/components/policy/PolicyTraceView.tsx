/**
 * PolicyTraceView: displays policy evaluation trace entries from intent
 * authorization. Shows which policies and rules matched/unmatched during
 * evaluation, with links to policy detail pages.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

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
      <div className="py-2">
        <p className="text-xs text-muted-foreground">No policy trace available.</p>
      </div>
    );
  }

  const summary = computeTraceSummary(entries);
  const sortedEntries = sortTraceEntries(entries);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit justify-start text-xs"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <span>
          {summary.totalRules} rules evaluated across {summary.uniquePolicies}{" "}
          {summary.uniquePolicies === 1 ? "policy" : "policies"} --{" "}
          <span className="text-entity-feature-fg">{summary.matchedRules} matched</span>
          {summary.unmatchedRules > 0 && (
            <span className="text-muted-foreground">, {summary.unmatchedRules} unmatched</span>
          )}
        </span>
        <span>{isExpanded ? "\u25B2" : "\u25BC"}</span>
      </Button>

      {isExpanded && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Policy</th>
                <th className="px-2 py-1.5 font-medium">Version</th>
                <th className="px-2 py-1.5 font-medium">Rule</th>
                <th className="px-2 py-1.5 font-medium">Effect</th>
                <th className="px-2 py-1.5 font-medium">Matched</th>
                <th className="px-2 py-1.5 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr
                  key={`${entry.policy_id}-${entry.rule_id}`}
                  className={cn(
                    "border-b border-border",
                    entry.matched ? "bg-entity-feature-muted" : "bg-transparent",
                  )}
                >
                  <td className="px-2 py-1.5">
                    <Link
                      to="/policies/$policyId"
                      params={{ policyId: entry.policy_id }}
                      className="text-ring hover:underline"
                    >
                      {entry.policy_id}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">v{entry.policy_version}</td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{entry.rule_id}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={entry.effect === "deny" ? "destructive" : "secondary"}>
                      {entry.effect}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={entry.matched ? "default" : "outline"}>
                      {entry.matched ? "Yes" : "No"}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{entry.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
