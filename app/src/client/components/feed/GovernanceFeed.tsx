import { useNavigate } from "@tanstack/react-router";
import type {
  GovernanceFeedAction,
  GovernanceFeedItem,
  GovernanceFeedResponse,
} from "../../../shared/contracts";
import { useWorkspaceState } from "../../stores/workspace-state";
import { useViewState } from "../../stores/view-state";
import { abortSession } from "../../graph/orchestrator-api";
import { classifyFeedAction } from "./feed-action-routing";
import { FeedSection } from "./FeedSection";
import { Button } from "../ui/button";

async function executeEntityAction(
  workspaceId: string,
  entityId: string,
  action: string,
): Promise<void> {
  const response = await fetch(
    `/api/entities/${encodeURIComponent(entityId)}/actions?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
}

export function GovernanceFeed({
  feed,
  isLoading,
  error,
  onRefresh,
}: {
  feed: GovernanceFeedResponse | undefined;
  isLoading: boolean;
  error: string | undefined;
  onRefresh: () => void;
}) {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const navigateToDiscussEntity = useViewState((s) => s.navigateToDiscussEntity);
  const navigate = useNavigate();

  async function handleAction(item: GovernanceFeedItem, action: GovernanceFeedAction) {
    if (!workspaceId) return;

    const classification = classifyFeedAction(item, action);

    switch (classification.type) {
      case "navigate_discuss":
        navigateToDiscussEntity({
          id: item.entityId,
          kind: item.entityKind,
          name: item.entityName,
          ...(item.status ? { status: item.status } : {}),
        });
        void navigate({ to: "/chat" });
        return;

      case "navigate_review":
        void navigate({ to: `/review/${classification.sessionId}` as string });
        return;

      case "abort_session":
        await abortSession(workspaceId, classification.sessionId);
        onRefresh();
        return;

      case "entity_action":
        await executeEntityAction(workspaceId, item.entityId, action.action);
        onRefresh();
        return;
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-sm text-destructive">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>Retry</Button>
      </div>
    );
  }

  if (!feed && isLoading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading governance feed...</p>;
  }

  if (!feed) return undefined;

  const totalItems = feed.blocking.length + feed.review.length + feed.awareness.length;

  if (totalItems === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <p>No governance items require attention.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FeedSection tier="blocking" items={feed.blocking} onAction={handleAction} />
      <FeedSection tier="review" items={feed.review} onAction={handleAction} />
      <FeedSection tier="awareness" items={feed.awareness} onAction={handleAction} />
    </div>
  );
}
