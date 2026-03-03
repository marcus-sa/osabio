import { useNavigate } from "@tanstack/react-router";
import type {
  GovernanceFeedAction,
  GovernanceFeedItem,
  GovernanceFeedResponse,
} from "../../../shared/contracts";
import { useWorkspaceState } from "../../stores/workspace-state";
import { FeedSection } from "./FeedSection";

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
  const navigate = useNavigate();

  async function handleAction(item: GovernanceFeedItem, action: GovernanceFeedAction) {
    if (!workspaceId) return;

    if (action.action === "discuss") {
      void navigate({ to: "/chat", search: { discuss: item.entityId } });
      return;
    }

    await executeEntityAction(workspaceId, item.entityId, action.action);
    onRefresh();
  }

  if (error) {
    return (
      <div className="feed-error">
        <p>{error}</p>
        <button type="button" onClick={onRefresh}>Retry</button>
      </div>
    );
  }

  if (!feed && isLoading) {
    return <p className="feed-loading">Loading governance feed...</p>;
  }

  if (!feed) return undefined;

  const totalItems = feed.blocking.length + feed.review.length + feed.awareness.length;

  if (totalItems === 0) {
    return (
      <div className="feed-empty">
        <p>No governance items require attention.</p>
      </div>
    );
  }

  return (
    <div className="governance-feed">
      <FeedSection tier="blocking" items={feed.blocking} onAction={handleAction} />
      <FeedSection tier="review" items={feed.review} onAction={handleAction} />
      <FeedSection tier="awareness" items={feed.awareness} onAction={handleAction} />
    </div>
  );
}
