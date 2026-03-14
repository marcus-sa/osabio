/**
 * VersionDiffView: client-side structural diff between two policy versions.
 *
 * Pure diff functions compare rules, selector, and metadata fields.
 * No server endpoint needed (ADR-003) -- both versions are fetched
 * client-side and diffed in the browser.
 */

// ---------------------------------------------------------------------------
// Types (reuse from PolicyDetailPage shape)
// ---------------------------------------------------------------------------

type RulePredicate = {
  field: string;
  operator: string;
  value: string | number | boolean | string[];
};

type RuleCondition = RulePredicate | RulePredicate[];

type PolicyRule = {
  id: string;
  condition: RuleCondition;
  effect: "allow" | "deny";
  priority: number;
};

type PolicySelector = {
  workspace?: string;
  agent_role?: string;
  resource?: string;
};

type DiffablePolicy = {
  title: string;
  description?: string;
  version: number;
  selector: PolicySelector;
  rules: PolicyRule[];
  human_veto_required: boolean;
  max_ttl?: string;
};

// ---------------------------------------------------------------------------
// Diff result types
// ---------------------------------------------------------------------------

export type RuleDiff =
  | { kind: "added"; rule: PolicyRule }
  | { kind: "removed"; rule: PolicyRule }
  | { kind: "changed"; ruleId: string; oldRule: PolicyRule; newRule: PolicyRule };

export type FieldChange = {
  field: string;
  oldValue: string;
  newValue: string;
};

export type PolicyDiffResult = {
  ruleDiffs: RuleDiff[];
  selectorChanges: FieldChange[];
  metadataChanges: FieldChange[];
};

// ---------------------------------------------------------------------------
// Pure diff functions
// ---------------------------------------------------------------------------

function serializeCondition(condition: RuleCondition): string {
  const predicates = Array.isArray(condition) ? condition : [condition];
  return predicates
    .map(
      (p) =>
        `${p.field} ${p.operator} ${Array.isArray(p.value) ? `[${p.value.join(",")}]` : String(p.value)}`,
    )
    .join(" AND ");
}

function rulesAreEqual(a: PolicyRule, b: PolicyRule): boolean {
  return (
    a.effect === b.effect &&
    a.priority === b.priority &&
    serializeCondition(a.condition) === serializeCondition(b.condition)
  );
}

export function diffRules(
  oldRules: PolicyRule[],
  newRules: PolicyRule[],
): RuleDiff[] {
  const diffs: RuleDiff[] = [];
  const oldById = new Map(oldRules.map((r) => [r.id, r]));
  const newById = new Map(newRules.map((r) => [r.id, r]));

  for (const [id, oldRule] of oldById) {
    const newRule = newById.get(id);
    if (!newRule) {
      diffs.push({ kind: "removed", rule: oldRule });
    } else if (!rulesAreEqual(oldRule, newRule)) {
      diffs.push({ kind: "changed", ruleId: id, oldRule, newRule });
    }
  }

  for (const [id, newRule] of newById) {
    if (!oldById.has(id)) {
      diffs.push({ kind: "added", rule: newRule });
    }
  }

  return diffs;
}

export function diffSelector(
  oldSelector: PolicySelector,
  newSelector: PolicySelector,
): FieldChange[] {
  const fields: Array<keyof PolicySelector> = [
    "workspace",
    "agent_role",
    "resource",
  ];
  const changes: FieldChange[] = [];

  for (const field of fields) {
    const oldVal = oldSelector[field] ?? "(none)";
    const newVal = newSelector[field] ?? "(none)";
    if (oldVal !== newVal) {
      changes.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}

export function diffMetadata(
  oldPolicy: DiffablePolicy,
  newPolicy: DiffablePolicy,
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (oldPolicy.title !== newPolicy.title) {
    changes.push({
      field: "title",
      oldValue: oldPolicy.title,
      newValue: newPolicy.title,
    });
  }

  const oldDesc = oldPolicy.description ?? "(none)";
  const newDesc = newPolicy.description ?? "(none)";
  if (oldDesc !== newDesc) {
    changes.push({ field: "description", oldValue: oldDesc, newValue: newDesc });
  }

  if (oldPolicy.human_veto_required !== newPolicy.human_veto_required) {
    changes.push({
      field: "human_veto_required",
      oldValue: String(oldPolicy.human_veto_required),
      newValue: String(newPolicy.human_veto_required),
    });
  }

  const oldTtl = oldPolicy.max_ttl ?? "(none)";
  const newTtl = newPolicy.max_ttl ?? "(none)";
  if (oldTtl !== newTtl) {
    changes.push({ field: "max_ttl", oldValue: oldTtl, newValue: newTtl });
  }

  return changes;
}

export function computePolicyDiff(
  oldPolicy: DiffablePolicy,
  newPolicy: DiffablePolicy,
): PolicyDiffResult {
  return {
    ruleDiffs: diffRules(oldPolicy.rules, newPolicy.rules),
    selectorChanges: diffSelector(oldPolicy.selector, newPolicy.selector),
    metadataChanges: diffMetadata(oldPolicy, newPolicy),
  };
}

function hasDifferences(diff: PolicyDiffResult): boolean {
  return (
    diff.ruleDiffs.length > 0 ||
    diff.selectorChanges.length > 0 ||
    diff.metadataChanges.length > 0
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatConditionDisplay(condition: RuleCondition): string {
  return serializeCondition(condition);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionDiffView({
  oldPolicy,
  newPolicy,
  onClose,
}: {
  oldPolicy: DiffablePolicy;
  newPolicy: DiffablePolicy;
  onClose: () => void;
}) {
  const diff = computePolicyDiff(oldPolicy, newPolicy);

  return (
    <div className="policy-dialog__backdrop" onClick={onClose}>
      <div
        className="version-diff"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Diff: v${oldPolicy.version} vs v${newPolicy.version}`}
      >
        <div className="version-diff__header">
          <h3 className="version-diff__title">
            Version Diff: v{oldPolicy.version} → v{newPolicy.version}
          </h3>
          <button
            type="button"
            className="version-diff__close"
            onClick={onClose}
            aria-label="Close diff"
          >
            X
          </button>
        </div>

        {!hasDifferences(diff) ? (
          <p className="version-diff__no-changes">
            No structural differences between versions.
          </p>
        ) : (
          <div className="version-diff__content">
            {diff.metadataChanges.length > 0 && (
              <div className="version-diff__section">
                <h4 className="version-diff__section-title">Metadata</h4>
                <table className="version-diff__table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>v{oldPolicy.version}</th>
                      <th>v{newPolicy.version}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.metadataChanges.map((change) => (
                      <tr key={change.field}>
                        <td className="version-diff__field-name">
                          {change.field}
                        </td>
                        <td className="version-diff__old-value">
                          {change.oldValue}
                        </td>
                        <td className="version-diff__new-value">
                          {change.newValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {diff.selectorChanges.length > 0 && (
              <div className="version-diff__section">
                <h4 className="version-diff__section-title">Selector</h4>
                <table className="version-diff__table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>v{oldPolicy.version}</th>
                      <th>v{newPolicy.version}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.selectorChanges.map((change) => (
                      <tr key={change.field}>
                        <td className="version-diff__field-name">
                          {change.field}
                        </td>
                        <td className="version-diff__old-value">
                          {change.oldValue}
                        </td>
                        <td className="version-diff__new-value">
                          {change.newValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {diff.ruleDiffs.length > 0 && (
              <div className="version-diff__section">
                <h4 className="version-diff__section-title">Rules</h4>
                <div className="version-diff__rules">
                  {diff.ruleDiffs.map((rd) => {
                    if (rd.kind === "added") {
                      return (
                        <div
                          key={`add-${rd.rule.id}`}
                          className="version-diff__rule version-diff__rule--added"
                        >
                          <span className="version-diff__rule-badge version-diff__rule-badge--added">
                            Added
                          </span>
                          <span className="version-diff__rule-id">
                            {rd.rule.id}
                          </span>
                          <span className="version-diff__rule-detail">
                            {rd.rule.effect} (priority {rd.rule.priority}) --{" "}
                            {formatConditionDisplay(rd.rule.condition)}
                          </span>
                        </div>
                      );
                    }
                    if (rd.kind === "removed") {
                      return (
                        <div
                          key={`rm-${rd.rule.id}`}
                          className="version-diff__rule version-diff__rule--removed"
                        >
                          <span className="version-diff__rule-badge version-diff__rule-badge--removed">
                            Removed
                          </span>
                          <span className="version-diff__rule-id">
                            {rd.rule.id}
                          </span>
                          <span className="version-diff__rule-detail">
                            {rd.rule.effect} (priority {rd.rule.priority}) --{" "}
                            {formatConditionDisplay(rd.rule.condition)}
                          </span>
                        </div>
                      );
                    }
                    // changed
                    return (
                      <div
                        key={`chg-${rd.ruleId}`}
                        className="version-diff__rule version-diff__rule--changed"
                      >
                        <span className="version-diff__rule-badge version-diff__rule-badge--changed">
                          Changed
                        </span>
                        <span className="version-diff__rule-id">
                          {rd.ruleId}
                        </span>
                        <div className="version-diff__rule-comparison">
                          <div className="version-diff__rule-old">
                            {rd.oldRule.effect} (priority {rd.oldRule.priority})
                            -- {formatConditionDisplay(rd.oldRule.condition)}
                          </div>
                          <div className="version-diff__rule-new">
                            {rd.newRule.effect} (priority {rd.newRule.priority})
                            -- {formatConditionDisplay(rd.newRule.condition)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
