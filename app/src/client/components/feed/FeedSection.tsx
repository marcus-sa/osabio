import type {
  GovernanceFeedAction,
  GovernanceFeedItem,
  GovernanceTier,
} from "../../../shared/contracts";
import { FeedItem } from "./FeedItem";

const TIER_CONFIG: Record<GovernanceTier, { label: string; icon: string }> = {
  blocking: { label: "Needs Decision", icon: "!!" },
  review: { label: "Needs Review", icon: "?" },
  awareness: { label: "Awareness", icon: "i" },
};

export function FeedSection({
  tier,
  items,
  onAction,
}: {
  tier: GovernanceTier;
  items: GovernanceFeedItem[];
  onAction: (item: GovernanceFeedItem, action: GovernanceFeedAction) => void;
}) {
  if (items.length === 0) return undefined;

  const config = TIER_CONFIG[tier];

  return (
    <section className={`feed-section feed-section--${tier}`}>
      <div className="feed-section-header">
        <span className="feed-section-icon">{config.icon}</span>
        <h3 className="feed-section-title">{config.label}</h3>
        <span className="feed-section-count">{items.length}</span>
      </div>
      <div className="feed-section-items">
        {items.map((item) => (
          <FeedItem
            key={item.id}
            item={item}
            onAction={(action) => onAction(item, action)}
          />
        ))}
      </div>
    </section>
  );
}
