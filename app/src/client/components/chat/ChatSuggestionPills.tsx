import type { EntityKind, GovernanceFeedResponse, GovernanceFeedItem } from "../../../shared/contracts";
import { useViewState } from "../../stores/view-state";
import { entityTwClasses } from "../graph/graph-theme";

const PILL_ENTITY_KINDS: EntityKind[] = ["question", "decision", "observation", "suggestion"];
const MAX_PILLS_PER_GROUP = 3;

const GROUP_LABELS: Record<string, string> = {
  question: "Open Questions",
  decision: "Pending Decisions",
  observation: "Observations",
  suggestion: "Pending Suggestions",
};

export function ChatSuggestionPills({ feed }: { feed: GovernanceFeedResponse | undefined }) {
  const navigateToDiscussEntity = useViewState((s) => s.navigateToDiscussEntity);

  if (!feed) return undefined;

  const allItems = [...feed.blocking, ...feed.review, ...feed.awareness];

  const groups = PILL_ENTITY_KINDS
    .map((kind) => ({
      kind,
      items: allItems.filter((item) => item.entityKind === kind).slice(0, MAX_PILLS_PER_GROUP),
    }))
    .filter((group) => group.items.length > 0);

  if (groups.length === 0) return undefined;

  function handlePillClick(item: GovernanceFeedItem) {
    navigateToDiscussEntity({
      id: item.entityId,
      kind: item.entityKind,
      name: item.entityName,
      ...(item.status ? { status: item.status } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-2">
      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-1">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABELS[group.kind]}</span>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item) => {
              const tw = entityTwClasses(item.entityKind);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-sm border px-2.5 py-1 text-xs transition-colors hover:opacity-80 ${tw.border} ${tw.mutedBg} ${tw.text}`}
                  onClick={() => handlePillClick(item)}
                >
                  {item.entityName}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
