import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EntityCategory, EntityDetailResponse, EntityKind, EntityPriority } from "../../../shared/contracts";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES } from "../../../shared/contracts";
import { CategoryBadge } from "./CategoryBadge";
import { DescriptionSection } from "./DescriptionSection";
import { EntityBadge } from "./EntityBadge";
import { RelationshipList } from "./RelationshipList";
import { ProvenanceSection } from "./ProvenanceSection";
import { AgentStatusSection } from "./AgentStatusSection";
import { useViewState } from "../../stores/view-state";
import { acceptSuggestion, confirmDecision, convertSuggestion, deferSuggestion, dismissSuggestion, markTaskComplete, overrideDecision, setEntityPriority } from "../../graph/actions";

const CONFIRMABLE_STATUSES = new Set(["extracted", "proposed", "provisional", "inferred"]);

const CATEGORY_TO_ENTITY_TYPE: Record<string, "task" | "feature" | "decision" | "project"> = {
  optimization: "task",
  risk: "decision",
  opportunity: "feature",
  conflict: "decision",
  missing: "task",
  pivot: "project",
};

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
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertKind, setConvertKind] = useState<"task" | "feature" | "decision" | "project">("task");
  const [convertTitle, setConvertTitle] = useState("");
  const navigateToDiscussEntity = useViewState((s) => s.navigateToDiscussEntity);
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

  function handleJumpToMessage(messageId: string, conversationId?: string) {
    if (conversationId) {
      void navigate({ to: "/chat/$conversationId", params: { conversationId }, search: { message: messageId } });
    } else {
      void navigate({ to: "/chat", search: { message: messageId } });
    }
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
  const showSuggestionActions = kind === "suggestion" && (status === "pending" || status === "deferred");

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
          {(kind === "task" || kind === "decision" || kind === "question") ? (
            <>
              <dt>Priority</dt>
              <dd>
                <select
                  value={(detail.entity.data.priority as string | undefined) ?? ""}
                  disabled={actionPending}
                  onChange={async (e) => {
                    const value = e.target.value as EntityPriority;
                    if (!value) return;
                    setActionPending(true);
                    try {
                      await setEntityPriority(workspaceId, entityId, value);
                      setDetail((prev) =>
                        prev
                          ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, priority: value } } }
                          : prev,
                      );
                    } finally {
                      setActionPending(false);
                    }
                  }}
                >
                  <option value="" disabled>—</option>
                  {ENTITY_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </dd>
            </>
          ) : undefined}
        </dl>
      </div>

      {kind === "task" ? (
        <AgentStatusSection
          entityId={entityId}
          workspaceId={workspaceId}
          entityKind={kind}
          entityStatus={status}
          agentSession={detail.agentSession}
        />
      ) : undefined}

      <DescriptionSection data={detail.entity.data} kind={kind} onEntityClick={onEntityClick} />

      {rationale ? (
        <div className="entity-detail-section">
          <h4>Rationale</h4>
          <p className="entity-detail-meta">{rationale}</p>
        </div>
      ) : undefined}

      <RelationshipList relationships={detail.relationships} onEntityClick={onEntityClick} />

      <ProvenanceSection provenance={detail.provenance} onJumpToMessage={handleJumpToMessage} />

      <div className="entity-detail-actions">
        <button
          type="button"
          onClick={() => {
            navigateToDiscussEntity({
              id: entityId,
              kind,
              name: detail.entity.name,
              ...(status ? { status } : {}),
            });
            void navigate({ to: "/chat" });
          }}
        >
          Discuss
        </button>
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
        {showSuggestionActions ? (
          <>
            <button type="button" disabled={actionPending} onClick={async () => {
              setActionPending(true);
              try {
                await acceptSuggestion(workspaceId, entityId);
                setDetail((prev) => prev ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "accepted" } } } : prev);
              } finally { setActionPending(false); }
            }}>Accept</button>
            <button type="button" disabled={actionPending} onClick={() => {
              const category = (detail.entity.data.category as string) ?? "";
              setConvertKind(CATEGORY_TO_ENTITY_TYPE[category] ?? "task");
              setConvertTitle(detail.entity.name);
              setShowConvertForm(true);
            }}>Convert</button>
            <button type="button" disabled={actionPending} onClick={async () => {
              setActionPending(true);
              try {
                await deferSuggestion(workspaceId, entityId);
                setDetail((prev) => prev ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "deferred" } } } : prev);
              } finally { setActionPending(false); }
            }}>Defer</button>
            <button type="button" disabled={actionPending} onClick={async () => {
              setActionPending(true);
              try {
                await dismissSuggestion(workspaceId, entityId);
                setDetail((prev) => prev ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "dismissed" } } } : prev);
              } finally { setActionPending(false); }
            }}>Dismiss</button>
          </>
        ) : undefined}
        {showConvertForm ? (
          <div className="entity-convert-form">
            <label>
              Convert to:
              <select value={convertKind} onChange={(e) => setConvertKind(e.target.value as typeof convertKind)}>
                <option value="task">Task</option>
                <option value="feature">Feature</option>
                <option value="decision">Decision</option>
                <option value="project">Project</option>
              </select>
            </label>
            <label>
              Title:
              <input type="text" value={convertTitle} onChange={(e) => setConvertTitle(e.target.value)} />
            </label>
            <div className="entity-convert-form-actions">
              <button type="button" disabled={actionPending || !convertTitle.trim()} onClick={async () => {
                setActionPending(true);
                try {
                  await convertSuggestion(workspaceId, entityId, convertKind, convertTitle.trim() || undefined);
                  setDetail((prev) => prev ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "converted" } } } : prev);
                  setShowConvertForm(false);
                } finally { setActionPending(false); }
              }}>Confirm</button>
              <button type="button" onClick={() => setShowConvertForm(false)}>Cancel</button>
            </div>
          </div>
        ) : undefined}
      </div>
    </aside>
  );
}
