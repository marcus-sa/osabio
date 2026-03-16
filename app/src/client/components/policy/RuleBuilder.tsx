/**
 * Inline rule editor for policy creation.
 *
 * Each rule has a condition (field/operator/value), effect (allow/deny), and priority.
 * Pure state transformations are extracted as standalone functions.
 * Field autocomplete is sourced from IntentEvaluationContext shape.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "../ui/button";

// ---------------------------------------------------------------------------
// Known fields from IntentEvaluationContext
// ---------------------------------------------------------------------------

export type FieldType = "string" | "number";

export type FieldSuggestion = {
  path: string;
  type: FieldType;
  description: string;
};

export const KNOWN_FIELDS: FieldSuggestion[] = [
  { path: "goal", type: "string", description: "Intent goal statement" },
  { path: "reasoning", type: "string", description: "Intent reasoning" },
  { path: "priority", type: "number", description: "Intent priority level" },
  { path: "action_spec.action", type: "string", description: "Action to perform" },
  { path: "action_spec.provider", type: "string", description: "Service provider" },
  { path: "action_spec.tool", type: "string", description: "Tool identifier" },
  { path: "budget_limit.amount", type: "number", description: "Budget amount limit" },
  { path: "budget_limit.currency", type: "string", description: "Budget currency code" },
  { path: "authorization_details.type", type: "string", description: "Authorization type" },
  { path: "requester_type", type: "string", description: "Type of requester" },
  { path: "requester_role", type: "string", description: "Role of requester" },
];

// ---------------------------------------------------------------------------
// Pure functions: autocomplete filtering
// ---------------------------------------------------------------------------

export function filterFields(query: string, knownFields: FieldSuggestion[]): FieldSuggestion[] {
  if (query.length === 0) return knownFields;
  const lower = query.toLowerCase();
  return knownFields.filter((f) => f.path.toLowerCase().includes(lower));
}

export function lookupFieldType(fieldPath: string, knownFields: FieldSuggestion[]): FieldType | undefined {
  return knownFields.find((f) => f.path === fieldPath)?.type;
}

// ---------------------------------------------------------------------------
// Pure functions: operator filtering by field type
// ---------------------------------------------------------------------------

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "greater or equal" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "less or equal" },
  { value: "in", label: "in" },
  { value: "not_in", label: "not in" },
  { value: "exists", label: "exists" },
] as const;

const STRING_OPERATORS: ReadonlySet<string> = new Set(["eq", "neq", "in", "not_in", "exists"]);
const NUMBER_OPERATORS: ReadonlySet<string> = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "exists"]);

export function getOperatorsForType(fieldType?: FieldType) {
  if (fieldType === "string") return OPERATORS.filter((op) => STRING_OPERATORS.has(op.value));
  if (fieldType === "number") return OPERATORS.filter((op) => NUMBER_OPERATORS.has(op.value));
  return [...OPERATORS];
}

// ---------------------------------------------------------------------------
// Pure functions: human-readable rule preview
// ---------------------------------------------------------------------------

const OPERATOR_DISPLAY: Record<string, string> = {
  eq: "equals", neq: "does not equal", gt: ">", gte: ">=", lt: "<", lte: "<=",
  in: "is in", not_in: "is not in", exists: "exists",
};

export function formatRulePreview(field: string, operator: string, value: string, effect: string): string {
  if (!field) return "";
  const effectLabel = effect === "deny" ? "Deny" : "Allow";
  const operatorLabel = OPERATOR_DISPLAY[operator] ?? operator;
  if (operator === "exists") return `${effectLabel} when ${field} ${operatorLabel}`;
  if (!value) return `${effectLabel} when ${field} ${operatorLabel} ...`;
  return `${effectLabel} when ${field} ${operatorLabel} ${value}`;
}

const EFFECTS = [
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
] as const;

export type RuleOperator = (typeof OPERATORS)[number]["value"];
export type RuleEffect = "allow" | "deny";

export type RuleEntry = {
  id: string;
  field: string;
  operator: RuleOperator;
  value: string;
  effect: RuleEffect;
  priority: number;
};

export function createEmptyRule(): RuleEntry {
  return { id: `rule-${crypto.randomUUID()}`, field: "", operator: "eq", value: "", effect: "allow", priority: 0 };
}

export function updateRuleField<K extends keyof RuleEntry>(rules: RuleEntry[], ruleId: string, field: K, value: RuleEntry[K]): RuleEntry[] {
  return rules.map((rule) => rule.id === ruleId ? { ...rule, [field]: value } : rule);
}

export function removeRule(rules: RuleEntry[], ruleId: string): RuleEntry[] {
  return rules.filter((rule) => rule.id !== ruleId);
}

export function appendRule(rules: RuleEntry[]): RuleEntry[] {
  return [...rules, createEmptyRule()];
}

export function ruleEntryToApiRule(entry: RuleEntry) {
  return { id: entry.id, condition: { field: entry.field, operator: entry.operator, value: entry.value }, effect: entry.effect, priority: entry.priority };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const inputClass = "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none";
const selectClass = "h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:border-ring focus:outline-none";

type RuleBuilderProps = {
  rules: RuleEntry[];
  onRulesChange: (rules: RuleEntry[]) => void;
};

function FieldAutocomplete({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestions = filterFields(value, KNOWN_FIELDS);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setShowSuggestions(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        className={`${inputClass} w-full`}
        placeholder="Field (e.g. goal)"
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowSuggestions(true); }}
        onFocus={() => setShowSuggestions(true)}
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 max-h-48 w-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {suggestions.map((s) => (
            <li key={s.path}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-hover"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(s.path); setShowSuggestions(false); }}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-foreground">{s.path}</span>
                  <span className="text-[0.6rem] text-muted-foreground">{s.type}</span>
                </span>
                <span className="text-muted-foreground">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleRow({ rule, onUpdate, onRemove, canRemove }: {
  rule: RuleEntry;
  onUpdate: <K extends keyof RuleEntry>(field: K, value: RuleEntry[K]) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const fieldType = lookupFieldType(rule.field, KNOWN_FIELDS);
  const availableOperators = getOperatorsForType(fieldType);
  const preview = formatRulePreview(rule.field, rule.operator, rule.value, rule.effect);

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_120px_1fr_80px_60px_auto] gap-1.5">
        <FieldAutocomplete value={rule.field} onChange={(v) => onUpdate("field", v)} />
        <select className={selectClass} value={rule.operator} onChange={(e) => onUpdate("operator", e.target.value as RuleOperator)}>
          {availableOperators.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
        <input type={fieldType === "number" ? "number" : "text"} className={inputClass} placeholder="Value" value={rule.value} onChange={(e) => onUpdate("value", e.target.value)} />
        <select className={selectClass} value={rule.effect} onChange={(e) => onUpdate("effect", e.target.value as RuleEffect)}>
          {EFFECTS.map((eff) => <option key={eff.value} value={eff.value}>{eff.label}</option>)}
        </select>
        <input type="number" className={inputClass} placeholder="Pri" value={rule.priority} onChange={(e) => onUpdate("priority", Number.parseInt(e.target.value, 10) || 0)} />
        <Button variant="ghost" size="icon-xs" onClick={onRemove} disabled={!canRemove} title="Remove rule" className="text-destructive">
          &times;
        </Button>
      </div>
      {preview && <p className="text-[0.65rem] italic text-muted-foreground">{preview}</p>}
    </div>
  );
}

export function RuleBuilder({ rules, onRulesChange }: RuleBuilderProps) {
  const handleUpdate = (ruleId: string) => {
    return <K extends keyof RuleEntry>(field: K, value: RuleEntry[K]) => {
      onRulesChange(updateRuleField(rules, ruleId, field, value));
    };
  };

  const handleRemove = (ruleId: string) => () => { onRulesChange(removeRule(rules, ruleId)); };
  const handleAdd = () => { onRulesChange(appendRule(rules)); };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Rules</span>
        <Button variant="outline" size="xs" onClick={handleAdd}>Add Rule</Button>
      </div>

      {rules.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No rules yet. Add at least one rule.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_120px_1fr_80px_60px_auto] gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Field</span>
            <span>Operator</span>
            <span>Value</span>
            <span>Effect</span>
            <span>Pri</span>
            <span />
          </div>
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} onUpdate={handleUpdate(rule.id)} onRemove={handleRemove(rule.id)} canRemove={rules.length > 1} />
          ))}
        </div>
      )}
    </div>
  );
}
