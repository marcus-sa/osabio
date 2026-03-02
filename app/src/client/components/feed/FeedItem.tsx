import type { GovernanceFeedAction, GovernanceFeedItem } from "../../../shared/contracts";
import { EntityBadge } from "../graph/EntityBadge";
import { CategoryBadge } from "../graph/CategoryBadge";

export function FeedItem({
  item,
  onAction,
}: {
  item: GovernanceFeedItem;
  onAction: (action: GovernanceFeedAction) => void;
}) {
  return (
    <div className={`feed-item feed-item--${item.tier}`}>
      <div className="feed-item-header">
        <div className="feed-item-badges">
          <EntityBadge kind={item.entityKind} />
          {item.category ? <CategoryBadge category={item.category} /> : undefined}
          {item.priority ? (
            <span className="feed-item-priority">{item.priority}</span>
          ) : undefined}
        </div>
        {item.status ? (
          <span className="feed-item-status">{item.status}</span>
        ) : undefined}
      </div>

      <p className="feed-item-name">{item.entityName}</p>
      <p className="feed-item-reason">{item.reason}</p>

      {item.conflictTarget ? (
        <p className="feed-item-conflict">
          Conflicts with: <strong>{item.conflictTarget.entityName}</strong>
        </p>
      ) : undefined}

      {item.project ? (
        <p className="feed-item-project">{item.project}</p>
      ) : undefined}

      <div className="feed-item-actions">
        {item.actions.map((action) => (
          <button
            key={action.action}
            type="button"
            className={`feed-action-btn feed-action-btn--${action.action}`}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
