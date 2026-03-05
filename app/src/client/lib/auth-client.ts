import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
});

export const { useSession, signIn, signUp, signOut } = authClient;
