import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EntityCategory, EntityDetailResponse, EntityKind, EntityPriority } from "../../../shared/contracts";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES } from "../../../shared/contracts";
import { CategoryBadge } from "./CategoryBadge";
import { EntityBadge } from "../ui/entity-badge";
import { StatusBadge } from "../ui/status-badge";
import { RelationshipList } from "./RelationshipList";
import { ProvenanceSection } from "./ProvenanceSection";
import { AgentStatusSection } from "./AgentStatusSection";
import { DescriptionSection } from "./DescriptionSection";
import { useViewState } from "../../stores/view-state";
import { acceptSuggestion, confirmDecision, convertSuggestion, deferSuggestion, dismissSuggestion, markTaskComplete, overrideDecision, setEntityPriority } from "../../graph/actions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { X } from "lucide-react";

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
      <aside className="absolute inset-y-0 right-0 z-10 flex w-[340px] flex-col border-l border-border bg-card py-4 animate-in slide-in-from-right">
        <p className="px-4 text-xs text-muted-foreground">Loading...</p>
      </aside>
    );
  }

  if (error || !detail) {
    return (
      <aside className="absolute inset-y-0 right-0 z-10 flex w-[340px] flex-col border-l border-border bg-card py-4 animate-in slide-in-from-right">
        <div className="flex items-start justify-between px-4">
          <p className="text-xs text-muted-foreground">{error ?? "Entity not found"}</p>
          <Button variant="ghost" size="icon-xs" onClick={onClose}><X className="size-3.5" /></Button>
        </div>
      </aside>
    );
  }

  const kind = detail.entity.kind as EntityKind;
  const status = (detail.entity.data.status as string | undefined) ?? "";
  const rationale = detail.entity.data.rationale as string | undefined;

  async function handleSuggestionAction(
    action: (workspaceId: string, entityId: string) => Promise<unknown>,
    resultStatus: string,
  ) {
    if (actionPending) return;
    setActionPending(true);
    try {
      await action(workspaceId, entityId);
      setDetail((prev) =>
        prev ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: resultStatus } } } : prev,
      );
    } finally {
      setActionPending(false);
    }
  }

  const showConfirm = kind === "decision" && CONFIRMABLE_STATUSES.has(status);
  const showOverride = kind === "decision" && CONFIRMABLE_STATUSES.has(status);
  const showComplete = kind === "task" && status !== "done";
  const showSuggestionActions = kind === "suggestion" && (status === "pending" || status === "deferred");

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-[340px] flex-col gap-3 overflow-y-auto border-l border-border bg-card py-4 animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4">
        <div className="flex flex-col gap-1">
          <EntityBadge kind={kind} />
          <h3 className="text-sm font-semibold text-foreground">{detail.entity.name}</h3>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}><X className="size-3.5" /></Button>
      </div>

      <Separator />

      {/* Metadata */}
      <div className="flex flex-col gap-1 px-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metadata</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {status ? (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd><StatusBadge status={status} /></dd>
            </>
          ) : undefined}
          {typeof detail.entity.data.category === "string" && (ENTITY_CATEGORIES as readonly string[]).includes(detail.entity.data.category) ? (
            <>
              <dt className="text-muted-foreground">Category</dt>
              <dd><CategoryBadge category={detail.entity.data.category as EntityCategory} /></dd>
            </>
          ) : undefined}
          {detail.entity.data.confidence !== undefined ? (
            <>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="text-foreground">{(detail.entity.data.confidence as number).toFixed(2)}</dd>
            </>
          ) : undefined}
          {detail.entity.data.created_at ? (
            <>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="text-foreground">{new Date(detail.entity.data.created_at as string).toLocaleDateString()}</dd>
            </>
          ) : undefined}
          {detail.entity.data.owner_name ? (
            <>
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="text-foreground">{detail.entity.data.owner_name as string}</dd>
            </>
          ) : undefined}
          {(kind === "task" || kind === "decision" || kind === "question") ? (
            <>
              <dt className="text-muted-foreground">Priority</dt>
              <dd>
                <select
                  className="h-6 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
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
        <div className="flex flex-col gap-1 px-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rationale</h4>
          <p className="text-xs text-muted-foreground">{rationale}</p>
        </div>
      ) : undefined}

      <RelationshipList relationships={detail.relationships} onEntityClick={onEntityClick} />

      <ProvenanceSection provenance={detail.provenance} onJumpToMessage={handleJumpToMessage} />

      <Separator />

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 px-4">
        <Button
          variant="outline"
          size="xs"
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
        </Button>
        {showConfirm ? (
          <Button variant="outline" size="xs" disabled={actionPending} onClick={handleConfirm}>
            Confirm
          </Button>
        ) : undefined}
        {showOverride ? (
          <Button variant="outline" size="xs" disabled={actionPending} onClick={handleOverride}>
            Override
          </Button>
        ) : undefined}
        {showComplete ? (
          <Button variant="outline" size="xs" disabled={actionPending} onClick={handleComplete}>
            Mark Complete
          </Button>
        ) : undefined}
        {showSuggestionActions ? (
          <>
            <Button variant="outline" size="xs" disabled={actionPending} onClick={() => handleSuggestionAction(acceptSuggestion, "accepted")}>Accept</Button>
            <Button variant="outline" size="xs" disabled={actionPending} onClick={() => {
              const category = (detail.entity.data.category as string) ?? "";
              setConvertKind(CATEGORY_TO_ENTITY_TYPE[category] ?? "task");
              setConvertTitle(detail.entity.name);
              setShowConvertForm(true);
            }}>Convert</Button>
            <Button variant="outline" size="xs" disabled={actionPending} onClick={() => handleSuggestionAction(deferSuggestion, "deferred")}>Defer</Button>
            <Button variant="destructive" size="xs" disabled={actionPending} onClick={() => handleSuggestionAction(dismissSuggestion, "dismissed")}>Dismiss</Button>
          </>
        ) : undefined}
      </div>

      {showConvertForm ? (
        <div className="flex flex-col gap-2 px-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Convert to:
            <select
              className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-ring focus:outline-none"
              value={convertKind}
              onChange={(e) => setConvertKind(e.target.value as typeof convertKind)}
            >
              <option value="task">Task</option>
              <option value="feature">Feature</option>
              <option value="decision">Decision</option>
              <option value="project">Project</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Title:
            <Input
              type="text"
              value={convertTitle}
              onChange={(e) => setConvertTitle(e.target.value)}
              className="h-7 text-xs"
            />
          </label>
          <div className="flex gap-1.5">
            <Button size="xs" disabled={actionPending || !convertTitle.trim()} onClick={async () => {
              setActionPending(true);
              try {
                await convertSuggestion(workspaceId, entityId, convertKind, convertTitle.trim() || undefined);
                setDetail((prev) => prev ? { ...prev, entity: { ...prev.entity, data: { ...prev.entity.data, status: "converted" } } } : prev);
                setShowConvertForm(false);
              } finally { setActionPending(false); }
            }}>Confirm</Button>
            <Button variant="ghost" size="xs" onClick={() => setShowConvertForm(false)}>Cancel</Button>
          </div>
        </div>
      ) : undefined}
    </aside>
  );
}
