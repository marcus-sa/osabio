import { useEffect, useState } from "react";
import type { DiscussEntitySummary, EntityDetailResponse, EntityKind } from "../../../shared/contracts";
import { EntityBadge } from "../graph/EntityBadge";

type Props = {
  entityId?: string;
  conversationRef?: DiscussEntitySummary;
  workspaceId: string;
};

export function DiscussEntityCard({ entityId, conversationRef, workspaceId }: Props) {
  const [fetched, setFetched] = useState<DiscussEntitySummary | undefined>();
  const [loading, setLoading] = useState(false);

  const displayEntity = conversationRef ?? fetched;

  useEffect(() => {
    if (conversationRef || !entityId) return;
    setLoading(true);
    fetch(`/api/entities/${encodeURIComponent(entityId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json() as Promise<EntityDetailResponse>;
      })
      .then((data) => {
        setFetched({
          id: data.entity.id,
          kind: data.entity.kind,
          name: data.entity.name,
          ...(typeof data.entity.data.status === "string" ? { status: data.entity.data.status } : {}),
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [entityId, conversationRef, workspaceId]);

  if (!displayEntity && !loading) return undefined;

  return (
    <div className="discuss-entity-card">
      {loading ? (
        <span className="discuss-entity-loading">Loading entity...</span>
      ) : displayEntity ? (
        <>
          <EntityBadge kind={displayEntity.kind as EntityKind} />
          <span className="discuss-entity-name">{displayEntity.name}</span>
          {displayEntity.status ? (
            <span className="discuss-entity-status">{displayEntity.status}</span>
          ) : undefined}
        </>
      ) : undefined}
    </div>
  );
}
