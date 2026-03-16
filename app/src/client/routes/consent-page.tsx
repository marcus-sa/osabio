import { useState, useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import { useSession } from "../lib/auth-client";
import { getScopeDescription } from "../../shared/scopes";
import { Button } from "../components/ui/button";

type ClientInfo = { client_name: string };

export function ConsentPage() {
  const { data: session, isPending: sessionPending } = useSession();
  const search = useSearch({ strict: false }) as Record<string, string>;

  const [clientName, setClientName] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const clientId = search.client_id;
  const scopeString = search.scope ?? "";
  const scopes = scopeString.split(" ").filter(Boolean);

  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/auth/oauth-client/${encodeURIComponent(clientId)}`)
      .then((res) => (res.ok ? res.json() : undefined))
      .then((data: ClientInfo | undefined) => {
        if (data?.client_name) setClientName(data.client_name);
      })
      .catch(() => {});
  }, [clientId]);

  if (!sessionPending && !session) {
    const params = new URLSearchParams(search);
    window.location.href = `/sign-in?redirectTo=${encodeURIComponent(`/consent?${params.toString()}`)}`;
    return undefined;
  }

  async function handleConsent(accept: boolean) {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept,
          ...(accept ? { scope: scopeString } : {}),
          oauth_query: new URLSearchParams(search).toString(),
        }),
      });

      const data = await res.json() as { url?: string; redirect?: boolean };

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setError("Unexpected response from authorization server");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Consent request failed");
    } finally {
      setLoading(false);
    }
  }

  if (sessionPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <h1 className="text-lg font-semibold text-foreground">Authorize Application</h1>

        <p className="text-sm text-foreground">
          <strong>{clientName ?? clientId ?? "An application"}</strong> is requesting access to your account.
        </p>

        {session?.user && (
          <p className="text-xs text-muted-foreground">
            Signed in as <strong>{session.user.email ?? session.user.name}</strong>
          </p>
        )}

        {scopes.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">This will allow the application to:</p>
            <ul className="flex flex-col gap-1">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-xs">
                  <span className="text-foreground">{getScopeDescription(scope)}</span>
                  <span className="font-mono text-muted-foreground">{scope}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={() => handleConsent(true)} disabled={loading} className="flex-1">
            {loading ? "..." : "Allow"}
          </Button>
          <Button variant="outline" onClick={() => handleConsent(false)} disabled={loading} className="flex-1">
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}
