import { useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAgentActions, type AuthorityScopeInput } from "../hooks/use-agent-actions";
import { AuthorityScopeForm, AUTHORITY_ACTIONS } from "../components/agent/authority-scope-form";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

type AgentRuntime = "sandbox" | "external";

const RUNTIME_OPTIONS: { value: AgentRuntime; title: string; description: string }[] = [
  {
    value: "external",
    title: "External",
    description: "Connect an external coding agent via MCP proxy token.",
  },
  {
    value: "sandbox",
    title: "Sandbox",
    description: "Run an agent in a managed sandbox environment.",
  },
];

function buildDefaultScopes(): AuthorityScopeInput[] {
  return AUTHORITY_ACTIONS.map(({ action }) => ({ action, permission: "propose" as const }));
}

export function AgentCreatePage() {
  const navigate = useNavigate();
  const { createAgent, checkName, isSubmitting, error, clearError } = useAgentActions();

  const [selectedRuntime, setSelectedRuntime] = useState<AgentRuntime | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [scopes, setScopes] = useState<AuthorityScopeInput[]>(buildDefaultScopes);
  const [nameError, setNameError] = useState<string | undefined>();

  const handleNameBlur = useCallback(async () => {
    if (!name.trim()) {
      setNameError(undefined);
      return;
    }
    const available = await checkName(name.trim());
    if (!available) {
      setNameError("This name is already taken.");
    } else {
      setNameError(undefined);
    }
  }, [name, checkName]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRuntime || !name.trim()) return;

    clearError();
    const result = await createAgent({
      name: name.trim(),
      description: description.trim() || undefined,
      runtime: selectedRuntime,
      model: model.trim() || undefined,
      authority_scopes: scopes,
    });

    if (result) {
      void navigate({ to: "/agents" });
    }
  }

  // Step 1: Runtime selection
  if (!selectedRuntime) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Create Agent</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Choose a runtime for your new agent.
        </p>
        <div className="flex flex-col gap-3">
          {RUNTIME_OPTIONS.map(({ value, title, description: desc }) => (
            <button
              key={value}
              type="button"
              className="flex flex-col gap-1 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary hover:bg-muted"
              onClick={() => setSelectedRuntime(value)}
            >
              <span className="text-sm font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // Step 2: Creation form
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Create {selectedRuntime === "external" ? "External" : "Sandbox"} Agent</h1>
        <Button variant="ghost" size="sm" onClick={() => setSelectedRuntime(undefined)}>
          Back
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void handleNameBlur()}
            placeholder="e.g. Coding Agent"
          />
          {nameError ? (
            <p className="text-xs text-destructive">{nameError}</p>
          ) : undefined}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-description">Description</Label>
          <Textarea
            id="agent-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            rows={2}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-model">Model (optional)</Label>
          <Input
            id="agent-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-20250514"
          />
        </div>

        <AuthorityScopeForm scopes={scopes} onChange={setScopes} />

        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : undefined}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => void navigate({ to: "/agents" })}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create Agent"}
          </Button>
        </div>
      </form>
    </section>
  );
}
