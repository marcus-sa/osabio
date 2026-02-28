import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EntityCategory, EntityDetailResponse, EntityKind } from "../../../shared/contracts";
import { ENTITY_CATEGORIES } from "../../../shared/contracts";
import { CategoryBadge } from "./CategoryBadge";
import { EntityBadge } from "./EntityBadge";
import { RelationshipList } from "./RelationshipList";
import { ProvenanceSection } from "./ProvenanceSection";
import { useViewState } from "../../stores/view-state";
import { confirmDecision, overrideDecision, markTaskComplete } from "../../graph/actions";

const CONFIRMABLE_STATUSES = new Set(["extracted", "proposed", "provisional", "inferred"]);

export function EntityDetailPanel({
  entityId,
  workspaceId,
  onClose,
  onEntityClick,
}: {
  entityId: string;
  workspaceId: string;
  onClose: () => void;
  onEntityClick: (entityId: string) => void;
}) {
  const [detail, setDetail] = useState<EntityDetailResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [actionPending, setActionPending] = useState(false);
  const navigateToChat = useViewState((s) => s.navigateToChat);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError(undefined);

    fetch(`/api/entities/${encodeURIComponent(entityId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body);
        }
        return response.json() as Promise<EntityDetailResponse>;
      })
      .then((data) => {
        setDetail(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load entity");
        setLoading(false);
      });
  }, [entityId, workspaceId]);

  function handleJumpToMessage(messageId: string) {
    navigateToChat(messageId);
    void navigate({ to: "/" });
  }

  async function handleConfirm() {
    if (!detail || actionPending) return;
    setActionPending(true);
    try {
      await confirmDecision(workspaceId, entityId);
      setDetail((prev) =>
        prev
          ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "confirmed" } } }
          : prev,
      );
    } finally {
      setActionPending(false);
    }
  }

  async function handleOverride() {
    if (!detail || actionPending) return;
    const newSummary = window.prompt("New decision summary:");
    if (!newSummary) return;
    setActionPending(true);
    try {
      await overrideDecision(workspaceId, entityId, newSummary);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              entity: {
                ...prev.entity,
                name: newSummary,
                data: { ...prev.entity.data, status: "overridden", summary: newSummary },
              },
            }
          : prev,
      );
    } finally {
      setActionPending(false);
    }
  }

  async function handleComplete() {
    if (!detail || actionPending) return;
    setActionPending(true);
    try {
      await markTaskComplete(workspaceId, entityId);
      setDetail((prev) =>
        prev
          ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "done" } } }
          : prev,
      );
    } finally {
      setActionPending(false);
    }
  }

  if (loading) {
    return (
      <aside className="entity-detail-panel">
        <p className="entity-detail-meta">Loading...</p>
      </aside>
    );
  }

  if (error || !detail) {
    return (
      <aside className="entity-detail-panel">
        <div className="entity-detail-header">
          <p className="entity-detail-meta">{error ?? "Entity not found"}</p>
          <button type="button" className="entity-detail-close" onClick={onClose}>&times;</button>
        </div>
      </aside>
    );
  }

  const kind = detail.entity.kind as EntityKind;
  const status = (detail.entity.data.status as string | undefined) ?? "";
  const rationale = detail.entity.data.rationale as string | undefined;

  const showConfirm = kind === "decision" && CONFIRMABLE_STATUSES.has(status);
  const showOverride = kind === "decision" && CONFIRMABLE_STATUSES.has(status);
  const showComplete = kind === "task" && status !== "done";

  return (
    <aside className="entity-detail-panel">
      <div className="entity-detail-header">
        <div>
          <EntityBadge kind={kind} />
          <h3>{detail.entity.name}</h3>
        </div>
        <button type="button" className="entity-detail-close" onClick={onClose}>&times;</button>
      </div>

      <div className="entity-detail-section">
        <h4>Metadata</h4>
        <dl className="entity-detail-meta">
          {status ? (
            <>
              <dt>Status</dt>
              <dd>{status}</dd>
            </>
          ) : undefined}
          {typeof detail.entity.data.category === "string" && (ENTITY_CATEGORIES as readonly string[]).includes(detail.entity.data.category) ? (
            <>
              <dt>Category</dt>
              <dd><CategoryBadge category={detail.entity.data.category as EntityCategory} /></dd>
            </>
          ) : undefined}
          {detail.entity.data.confidence !== undefined ? (
            <>
              <dt>Confidence</dt>
              <dd>{(detail.entity.data.confidence as number).toFixed(2)}</dd>
            </>
          ) : undefined}
          {detail.entity.data.created_at ? (
            <>
              <dt>Created</dt>
              <dd>{new Date(detail.entity.data.created_at as string).toLocaleDateString()}</dd>
            </>
          ) : undefined}
          {detail.entity.data.owner_name ? (
            <>
              <dt>Owner</dt>
              <dd>{detail.entity.data.owner_name as string}</dd>
            </>
          ) : undefined}
          {detail.entity.data.priority ? (
            <>
              <dt>Priority</dt>
              <dd>{detail.entity.data.priority as string}</dd>
            </>
          ) : undefined}
        </dl>
      </div>

      {rationale ? (
        <div className="entity-detail-section">
          <h4>Rationale</h4>
          <p className="entity-detail-meta">{rationale}</p>
        </div>
      ) : undefined}

      <RelationshipList relationships={detail.relationships} onEntityClick={onEntityClick} />

      <ProvenanceSection provenance={detail.provenance} onJumpToMessage={handleJumpToMessage} />

      {(showConfirm || showOverride || showComplete) ? (
        <div className="entity-detail-actions">
          {showConfirm ? (
            <button type="button" disabled={actionPending} onClick={handleConfirm}>
              Confirm
            </button>
          ) : undefined}
          {showOverride ? (
            <button type="button" disabled={actionPending} onClick={handleOverride}>
              Override
            </button>
          ) : undefined}
          {showComplete ? (
            <button type="button" disabled={actionPending} onClick={handleComplete}>
              Mark Complete
            </button>
          ) : undefined}
        </div>
      ) : undefined}
    </aside>
  );
}
