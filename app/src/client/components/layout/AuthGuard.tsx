import type { ReactNode } from "react";
import { useSession } from "../../lib/auth-client";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="auth-guard-loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (!session) {
    const redirectTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/sign-in?redirectTo=${redirectTo}`;
    return undefined;
  }

  return <>{children}</>;
}
