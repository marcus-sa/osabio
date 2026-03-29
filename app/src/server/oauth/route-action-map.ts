/**
 * Route-Action Map: Deterministic HTTP route to OsabioAction mapping
 *
 * Pure data + pure function. No IO imports.
 */
import type { OsabioAction } from "./types";
import { createOsabioAction } from "./types";

type RouteActionMapping = {
  method: string;
  pathPattern: RegExp;
  action: string;
  resource: string;
};

const WS = "[^/]+"; // workspace slug segment

const ROUTE_ACTION_MAPPINGS: RouteActionMapping[] = [
  // Read operations
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/workspace-context$`), action: "read", resource: "workspace" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/context$`), action: "read", resource: "workspace" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/project-context$`), action: "read", resource: "project" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/task-context$`), action: "read", resource: "task" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/tasks/dependencies$`), action: "read", resource: "task" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/decisions$`), action: "read", resource: "decision" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/constraints$`), action: "read", resource: "constraint" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/changes$`), action: "read", resource: "change_log" },
  { method: "GET", pathPattern: new RegExp(`^/api/mcp/${WS}/entities/[^/]+$`), action: "read", resource: "entity" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/suggestions$`), action: "read", resource: "suggestion" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/intents/status$`), action: "read", resource: "intent" },

  // Reason operations
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/decisions/resolve$`), action: "reason", resource: "decision" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/constraints/check$`), action: "reason", resource: "constraint" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/commits/pre-check$`), action: "reason", resource: "commit" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/commits/post-check$`), action: "reason", resource: "commit" },

  // Create operations
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/decisions/provisional$`), action: "create", resource: "decision" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/questions$`), action: "create", resource: "question" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/tasks/subtask$`), action: "create", resource: "task" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/notes$`), action: "create", resource: "note" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/observations$`), action: "create", resource: "observation" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/suggestions/create$`), action: "create", resource: "suggestion" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/sessions/start$`), action: "create", resource: "session" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/commits$`), action: "create", resource: "commit" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/intents/create$`), action: "create", resource: "intent" },

  // Update operations
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/tasks/status$`), action: "update", resource: "task" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/sessions/end$`), action: "update", resource: "session" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/suggestions/action$`), action: "update", resource: "suggestion" },
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/suggestions/convert$`), action: "update", resource: "suggestion" },

  // Submit operations
  { method: "POST", pathPattern: new RegExp(`^/api/mcp/${WS}/intents/submit$`), action: "submit", resource: "intent" },
];

export function deriveRequestedAction(
  method: string,
  path: string,
): OsabioAction | undefined {
  const mapping = ROUTE_ACTION_MAPPINGS.find(
    (m) => m.method === method && m.pathPattern.test(path),
  );

  if (!mapping) return undefined;

  return createOsabioAction(mapping.action, mapping.resource);
}
