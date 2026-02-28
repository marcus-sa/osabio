import type { EntityActionRequest } from "../../shared/contracts";

async function executeAction(workspaceId: string, entityId: string, body: EntityActionRequest): Promise<void> {
  const response = await fetch(
    `/api/entities/${encodeURIComponent(entityId)}/actions?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
}

export function confirmDecision(workspaceId: string, decisionId: string, notes?: string): Promise<void> {
  return executeAction(workspaceId, decisionId, { action: "confirm", notes });
}

export function overrideDecision(workspaceId: string, decisionId: string, newSummary: string, notes?: string): Promise<void> {
  return executeAction(workspaceId, decisionId, { action: "override", newSummary, notes });
}

export function markTaskComplete(workspaceId: string, taskId: string): Promise<void> {
  return executeAction(workspaceId, taskId, { action: "complete" });
}
