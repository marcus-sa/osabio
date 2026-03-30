import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

type EnforcementTransition = {
  from: string;
  to: string;
  trigger: "auto" | "manual";
  timestamp: string;
};

type WorkspaceSettings = {
  enforcementMode: string;
  sandboxProvider?: string;
  thresholds: Record<string, number>;
  transitions?: EnforcementTransition[];
};

const ENFORCEMENT_MODES = ["bootstrap", "soft", "hard"] as const;
const SANDBOX_PROVIDERS = ["local", "e2b", "daytona", "docker"] as const;

function useWorkspaceSettings() {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [settings, setSettings] = useState<WorkspaceSettings | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchSettings = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/settings`,
      );
      if (!response.ok) {
        setError("Failed to load settings");
        return;
      }
      const data = (await response.json()) as WorkspaceSettings;
      setSettings(data);
    } catch {
      setError("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const saveSettings = useCallback(
    async (patch: { enforcementMode?: string; sandboxProvider?: string; thresholds?: Record<string, number> }) => {
      if (!workspaceId) return;
      setError(undefined);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/settings`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        if (!response.ok) {
          setError("Failed to save settings");
          return;
        }
        await fetchSettings();
      } catch {
        setError("Failed to save settings");
      }
    },
    [workspaceId, fetchSettings],
  );

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return { settings, isLoading, error, refresh: fetchSettings, saveSettings };
}

export function SettingsPage() {
  const workspaceName = useWorkspaceState((s) => s.workspaceName);
  const { settings, isLoading, error, saveSettings } = useWorkspaceSettings();
  const [editedMode, setEditedMode] = useState<string | undefined>();
  const [editedThresholds, setEditedThresholds] = useState<Record<string, number>>({});

  useEffect(() => {
    if (settings?.enforcementMode) {
      setEditedMode(settings.enforcementMode);
    }
    if (settings?.thresholds) {
      setEditedThresholds({ ...settings.thresholds });
    }
  }, [settings?.enforcementMode, settings?.thresholds]);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>

      {error ? <p className="text-sm text-destructive">{error}</p> : undefined}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      ) : settings ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Workspace</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm text-foreground">{workspaceName}</span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Evidence Enforcement
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mode</span>
              <Select
                value={editedMode ?? settings.enforcementMode}
                onValueChange={(value) => setEditedMode(value as string)}
              >
                <SelectTrigger aria-label="Enforcement Mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENFORCEMENT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="secondary" data-testid="enforcement-mode-badge">
                {settings.enforcementMode}
              </Badge>
            </div>
            {Object.keys(settings.thresholds).length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Thresholds
                </span>
                {Object.entries(editedThresholds).map(([key, value]) => {
                  const label = key.replace(/_/g, " ");
                  const inputId = `threshold-${key}`;
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <label htmlFor={inputId} className="text-muted-foreground">
                        {label}
                      </label>
                      <input
                        id={inputId}
                        aria-label={label}
                        type="number"
                        min={0}
                        value={value}
                        onChange={(event) => {
                          setEditedThresholds((previous) => ({
                            ...previous,
                            [key]: Number(event.target.value),
                          }));
                        }}
                        className="w-20 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground"
                      />
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    void saveSettings({
                      enforcementMode: editedMode ?? settings.enforcementMode,
                      thresholds: editedThresholds,
                    });
                  }}
                  className="mt-1 w-fit rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90"
                >
                  Save Settings
                </button>
              </div>
            ) : undefined}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Sandbox Provider
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Provider</span>
              <Select
                value={settings.sandboxProvider ?? ""}
                onValueChange={(value) => {
                  void saveSettings({ sandboxProvider: value as string });
                }}
              >
                <SelectTrigger aria-label="Sandbox Provider">
                  <SelectValue placeholder="Not configured" />
                </SelectTrigger>
                <SelectContent>
                  {SANDBOX_PROVIDERS.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {settings.transitions && settings.transitions.length > 0 ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Enforcement Transition History
              </h2>
              <div className="flex flex-col gap-2">
                {settings.transitions.map((transition, index) => {
                  const formattedTime = new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(transition.timestamp));
                  return (
                    <div
                      key={`${transition.timestamp}-${index}`}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span className="text-muted-foreground">{formattedTime}</span>
                      <span className="text-foreground">
                        {transition.from} &rarr; {transition.to}
                      </span>
                      <Badge variant="outline">
                        {transition.trigger}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : undefined}
        </div>
      ) : undefined}
    </section>
  );
}
