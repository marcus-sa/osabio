import { useState } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { signIn, signUp, useSession } from "../lib/auth-client";
import { usePublicConfig } from "../hooks/use-public-config";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";

export function SignInPage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, string>;
  const config = usePublicConfig();

  const signupAllowed = !config.selfHosted;
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const effectiveMode = signupAllowed ? mode : "signin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isPending && session) {
    const redirectTo = search.redirectTo ?? "/";
    void navigate({ to: redirectTo });
    return undefined;
  }

  function getPostLoginRedirect(): string {
    const { redirectTo, ...oauthParams } = search;
    if (redirectTo) return redirectTo;
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
      if (effectiveMode === "signup") {
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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <h1 className="text-center text-xl font-bold text-accent">Brain</h1>
        <p className="text-center text-sm text-muted-foreground">
          {effectiveMode === "signin" ? "Sign in to your workspace" : "Create an account"}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {effectiveMode === "signup" && (
            <Input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={loading}>
            {loading ? "..." : effectiveMode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <Button variant="outline" onClick={handleGitHub}>
          Sign in with GitHub
        </Button>

        {signupAllowed && (
          <p className="text-center text-xs text-muted-foreground">
            {effectiveMode === "signin" ? (
              <>
                No account?{" "}
                <button type="button" className="text-ring hover:underline" onClick={() => { setMode("signup"); setError(""); }}>
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" className="text-ring hover:underline" onClick={() => { setMode("signin"); setError(""); }}>
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
