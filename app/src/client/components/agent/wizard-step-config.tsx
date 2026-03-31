import { useCallback } from "react";
import type { AuthorityScopeInput } from "../../hooks/use-agent-actions";
import { AuthorityScopeForm } from "./authority-scope-form";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

type AgentRuntime = "sandbox" | "external";

type SandboxConfigState = {
  image: string;
  snapshot: string;
};

export type ConfigStepState = {
  runtime: AgentRuntime;
  name: string;
  description: string;
  model: string;
  scopes: AuthorityScopeInput[];
  sandboxConfig: SandboxConfigState;
};

type WizardStepConfigProps = {
  state: ConfigStepState;
  onChange: (state: ConfigStepState) => void;
  nameError?: string;
  onNameBlur: () => void;
  onNext: () => void;
  onCancel: () => void;
  isNextDisabled: boolean;
};

const RUNTIME_OPTIONS: { value: AgentRuntime; title: string; description: string }[] = [
  {
    value: "sandbox",
    title: "Sandbox",
    description: "Run an agent in a managed sandbox environment.",
  },
  {
    value: "external",
    title: "External",
    description: "Connect an external coding agent via MCP proxy token.",
  },
];

function updateField<K extends keyof ConfigStepState>(
  state: ConfigStepState,
  field: K,
  value: ConfigStepState[K],
): ConfigStepState {
  return { ...state, [field]: value };
}

function updateSandboxField(
  state: ConfigStepState,
  field: keyof SandboxConfigState,
  value: string,
): ConfigStepState {
  return { ...state, sandboxConfig: { ...state.sandboxConfig, [field]: value } };
}

export function WizardStepConfig({
  state,
  onChange,
  nameError,
  onNameBlur,
  onNext,
  onCancel,
  isNextDisabled,
}: WizardStepConfigProps) {
  const handleRuntimeChange = useCallback(
    (runtime: AgentRuntime) => onChange(updateField(state, "runtime", runtime)),
    [state, onChange],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Runtime radio group */}
      <fieldset className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Runtime</span>
        <div className="flex gap-3">
          {RUNTIME_OPTIONS.map(({ value, title, description: desc }) => (
            <label
              key={value}
              className={`flex flex-1 cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                state.runtime === value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="agent-runtime"
                  value={value}
                  checked={state.runtime === value}
                  onChange={() => handleRuntimeChange(value)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">{title}</span>
              </div>
              <span className="pl-5 text-xs text-muted-foreground">{desc}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          value={state.name}
          onChange={(e) => onChange(updateField(state, "name", e.target.value))}
          onBlur={onNameBlur}
          placeholder="e.g. Coding Agent"
        />
        {nameError ? (
          <p className="text-xs text-destructive">{nameError}</p>
        ) : undefined}
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-description">Description</Label>
        <Textarea
          id="agent-description"
          value={state.description}
          onChange={(e) => onChange(updateField(state, "description", e.target.value))}
          placeholder="What does this agent do?"
          rows={2}
        />
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-model">Model (optional)</Label>
        <Input
          id="agent-model"
          value={state.model}
          onChange={(e) => onChange(updateField(state, "model", e.target.value))}
          placeholder="e.g. claude-sonnet-4-20250514"
        />
      </div>

      {/* Sandbox config (conditional) */}
      {state.runtime === "sandbox" ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Sandbox Configuration</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sandbox-image">Image (optional)</Label>
            <Input
              id="sandbox-image"
              value={state.sandboxConfig.image}
              onChange={(e) => onChange(updateSandboxField(state, "image", e.target.value))}
              placeholder="e.g. node:20-slim"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sandbox-snapshot">Snapshot (optional)</Label>
            <Input
              id="sandbox-snapshot"
              value={state.sandboxConfig.snapshot}
              onChange={(e) => onChange(updateSandboxField(state, "snapshot", e.target.value))}
              placeholder="Snapshot ID"
            />
          </div>
        </fieldset>
      ) : undefined}

      {/* Authority scopes */}
      <AuthorityScopeForm scopes={state.scopes} onChange={(scopes) => onChange(updateField(state, "scopes", scopes))} />

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="button" onClick={onNext} disabled={isNextDisabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
