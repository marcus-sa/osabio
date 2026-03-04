import type { EntityKind, GovernanceFeedResponse, GovernanceFeedItem } from "../../../shared/contracts";
import { useViewState } from "../../stores/view-state";
import { entityColor, entityMutedColor } from "../graph/graph-theme";

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
    <div className="chat-suggestion-pills">
      {groups.map((group) => (
        <div key={group.kind} className="chat-suggestion-group">
          <span className="chat-suggestion-group-label">{GROUP_LABELS[group.kind]}</span>
          <div className="chat-suggestion-group-items">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chat-suggestion-pill"
                style={{
                  borderColor: entityColor(item.entityKind),
                  background: entityMutedColor(item.entityKind),
                  color: entityColor(item.entityKind),
                }}
                onClick={() => handlePillClick(item)}
              >
                {item.entityName}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
