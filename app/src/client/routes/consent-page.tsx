import { useState, useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import { useSession } from "../lib/auth-client";
import { getScopeDescription } from "../../shared/scopes";

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

  // Fetch client name for display
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/auth/oauth-client/${encodeURIComponent(clientId)}`)
      .then((res) => (res.ok ? res.json() : undefined))
      .then((data: ClientInfo | undefined) => {
        if (data?.client_name) setClientName(data.client_name);
      })
      .catch(() => {});
  }, [clientId]);

  // Redirect to sign-in if not authenticated
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
      <div className="consent-page">
        <div className="consent-card">
          <p className="consent-loading">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="consent-page">
      <div className="consent-card">
        <h1 className="consent-title">Authorize Application</h1>

        <p className="consent-client">
          <strong>{clientName ?? clientId ?? "An application"}</strong> is requesting access to your account.
        </p>

        {session?.user && (
          <p className="consent-user">
            Signed in as <strong>{session.user.email ?? session.user.name}</strong>
          </p>
        )}

        {scopes.length > 0 && (
          <div className="consent-scopes">
            <p className="consent-scopes-label">This will allow the application to:</p>
            <ul className="consent-scope-list">
              {scopes.map((scope) => (
                <li key={scope} className="consent-scope-item">
                  <span className="consent-scope-desc">{getScopeDescription(scope)}</span>
                  <span className="consent-scope-name">{scope}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="consent-error">{error}</p>}

        <div className="consent-actions">
          <button
            type="button"
            className="consent-button consent-allow"
            onClick={() => handleConsent(true)}
            disabled={loading}
          >
            {loading ? "..." : "Allow"}
          </button>
          <button
            type="button"
            className="consent-button consent-deny"
            onClick={() => handleConsent(false)}
            disabled={loading}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
