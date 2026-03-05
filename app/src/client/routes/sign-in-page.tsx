import { useState } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { signIn, signUp, useSession } from "../lib/auth-client";

export function SignInPage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, string>;

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect away
  if (!isPending && session) {
    const redirectTo = search.redirectTo ?? "/";
    void navigate({ to: redirectTo });
    return undefined;
  }

  // Build the URL to resume the OAuth flow after login.
  // better-auth passes the original OAuth query params (signed) to the login page.
  // After login we redirect back to /api/auth/oauth2/authorize with those params.
  function getPostLoginRedirect(): string {
    const { redirectTo, ...oauthParams } = search;

    // If there's an explicit redirectTo, use it
    if (redirectTo) return redirectTo;

    // If OAuth params are present (client_id, sig, etc.), resume the authorize flow
    if (oauthParams.client_id || oauthParams.sig) {
      const params = new URLSearchParams(oauthParams);
      return `/api/auth/oauth2/authorize?${params.toString()}`;
    }

    return "/";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const result = await signUp.email({ email, password, name });
        if (result.error) {
          setError(result.error.message ?? "Sign up failed");
          setLoading(false);
          return;
        }
      } else {
        const result = await signIn.email({ email, password });
        if (result.error) {
          setError(result.error.message ?? "Invalid credentials");
          setLoading(false);
          return;
        }
      }

      // Redirect after successful auth
      window.location.href = getPostLoginRedirect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
      setLoading(false);
    }
  }

  async function handleGitHub() {
    setError("");
    await signIn.social({
      provider: "github",
      callbackURL: getPostLoginRedirect(),
    });
  }

  if (isPending) {
    return (
      <div className="sign-in-page">
        <div className="sign-in-card">
          <p className="sign-in-loading">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">Brain</h1>
        <p className="sign-in-subtitle">
          {mode === "signin" ? "Sign in to your workspace" : "Create an account"}
        </p>

        <form onSubmit={handleSubmit} className="sign-in-form">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sign-in-input"
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="sign-in-input"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="sign-in-input"
            required
            minLength={8}
          />

          {error && <p className="sign-in-error">{error}</p>}

          <button type="submit" className="sign-in-button" disabled={loading}>
            {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="sign-in-divider">
          <span>or</span>
        </div>

        <button type="button" className="sign-in-button sign-in-github" onClick={handleGitHub}>
          Sign in with GitHub
        </button>

        <p className="sign-in-switch">
          {mode === "signin" ? (
            <>
              No account?{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(""); }}>
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => { setMode("signin"); setError(""); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
