import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";
import { Badge } from "../components/ui/badge";

type WorkspaceSettings = {
  enforcementMode: string;
  thresholds: Record<string, number>;
};

const ENFORCEMENT_MODES = ["bootstrap", "soft", "hard"] as const;

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

  const updateEnforcementMode = useCallback(
    async (mode: string) => {
      if (!workspaceId) return;
      setError(undefined);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/settings`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enforcementMode: mode }),
          },
        );
        if (!response.ok) {
          setError("Failed to update enforcement mode");
          return;
        }
        await fetchSettings();
      } catch {
        setError("Failed to update enforcement mode");
      }
    },
    [workspaceId, fetchSettings],
  );

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const updateThresholds = useCallback(
    async (thresholds: Record<string, number>) => {
      if (!workspaceId) return;
      setError(undefined);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/settings`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thresholds }),
          },
        );
        if (!response.ok) {
          setError("Failed to update thresholds");
          return;
        }
        await fetchSettings();
      } catch {
        setError("Failed to update thresholds");
      }
    },
    [workspaceId, fetchSettings],
  );

  return { settings, isLoading, error, refresh: fetchSettings, updateEnforcementMode, updateThresholds };
}

export function SettingsPage() {
  const workspaceName = useWorkspaceState((s) => s.workspaceName);
  const { settings, isLoading, error, updateEnforcementMode, updateThresholds } = useWorkspaceSettings();
  const [editedThresholds, setEditedThresholds] = useState<Record<string, number>>({});

  useEffect(() => {
    if (settings?.thresholds) {
      setEditedThresholds({ ...settings.thresholds });
    }
  }, [settings?.thresholds]);

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
              <label
                htmlFor="enforcement-mode-select"
                className="text-sm text-muted-foreground"
              >
                Mode
              </label>
              <select
                id="enforcement-mode-select"
                aria-label="Enforcement Mode"
                value={settings.enforcementMode}
                onChange={(event) => {
                  void updateEnforcementMode(event.target.value);
                }}
                className="rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground"
              >
                {ENFORCEMENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
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
                    void updateThresholds(editedThresholds);
                  }}
                  className="mt-1 w-fit rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90"
                >
                  Save Thresholds
                </button>
              </div>
            ) : undefined}
          </div>
        </div>
      ) : undefined}
    </section>
  );
}
