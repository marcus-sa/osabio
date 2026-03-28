import type {
  GovernanceFeedAction,
  GovernanceFeedItem,
  GovernanceTier,
} from "../../../shared/contracts";
import { FeedItem } from "./FeedItem";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";

const TIER_CONFIG: Record<GovernanceTier, { label: string; icon: string; borderClass: string }> = {
  blocking: { label: "Needs Decision", icon: "!!", borderClass: "border-l-tier-blocking" },
  review: { label: "Needs Review", icon: "?", borderClass: "border-l-tier-review" },
  awareness: { label: "Awareness", icon: "i", borderClass: "border-l-tier-awareness" },
};

export function FeedSection({
  tier,
  items,
  onAction,
  onEvidenceClick,
}: {
  tier: GovernanceTier;
  items: GovernanceFeedItem[];
  onAction: (item: GovernanceFeedItem, action: GovernanceFeedAction) => void;
  onEvidenceClick?: (entityId: string) => void;
}) {
  if (items.length === 0) return undefined;

  const config = TIER_CONFIG[tier];

  return (
    <section className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card p-3 border-l-3", config.borderClass)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold">{config.icon}</span>
        <h3 className="text-xs font-semibold text-foreground">{config.label}</h3>
        <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[0.6rem]">{items.length}</Badge>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <FeedItem
            key={item.id}
            item={item}
            onAction={(action) => onAction(item, action)}
            onEvidenceClick={onEvidenceClick}
          />
        ))}
      </div>
    </section>
  );
}
