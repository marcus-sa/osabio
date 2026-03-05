/** OAuth scope name → human-readable description. Shared between server and client. */
export const BRAIN_SCOPES = {
  "graph:read": "Read workspace graph data",
  "graph:reason": "Use reasoning tools (resolve decisions, check constraints)",
  "decision:write": "Create and confirm decisions",
  "task:write": "Create tasks, update status",
  "observation:write": "Log observations",
  "question:write": "Ask questions",
  "session:write": "Start and end agent sessions",
} as const;

/** Standard OAuth scopes with generic descriptions */
export const STANDARD_SCOPES: Record<string, string> = {
  openid: "Verify your identity",
  profile: "Access your profile information",
  email: "Access your email address",
  offline_access: "Stay connected when you're not using the app",
};

/** Get a human-readable description for a scope */
export function getScopeDescription(scope: string): string {
  return (BRAIN_SCOPES as Record<string, string>)[scope] ?? STANDARD_SCOPES[scope] ?? scope;
}
