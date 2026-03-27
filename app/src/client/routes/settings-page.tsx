import { useCallback, useEffect, useState } from "react";
import { useWorkspaceState } from "../stores/workspace-state";
import { Badge } from "../components/ui/badge";

type WorkspaceSettings = {
  enforcementMode: string;
  thresholds: Record<string, number>;
};

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

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return { settings, isLoading, error, refresh: fetchSettings };
}

export function SettingsPage() {
  const workspaceName = useWorkspaceState((s) => s.workspaceName);
  const { settings, isLoading, error } = useWorkspaceSettings();

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
              <Badge variant="secondary">{settings.enforcementMode}</Badge>
            </div>
            {Object.keys(settings.thresholds).length > 0 ? (
              <div className="mt-3 flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Thresholds
                </span>
                {Object.entries(settings.thresholds).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
                    <span className="text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            ) : undefined}
          </div>
        </div>
      ) : undefined}
    </section>
  );
}
