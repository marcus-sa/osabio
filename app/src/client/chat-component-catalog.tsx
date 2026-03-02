import { componentCatalog } from "reachat";
import { useState } from "react";
import type { ExtractableKind } from "../shared/chat-component-definitions";
import {
  chatComponentDefinitions,
  type EntityCardProps,
  type ExtractionSummaryProps,
  type WorkItemSuggestionProps,
  type WorkItemSuggestionListProps,
} from "../shared/chat-component-definitions";
import { InlineRelationshipGraph } from "./components/chat/InlineRelationshipGraph";
import { CategoryBadge } from "./components/graph/CategoryBadge";
import { useViewState } from "./stores/view-state";
import { useWorkspaceState } from "./stores/workspace-state";

const kindLabelByKind: Record<ExtractableKind, string> = {
  project: "Project",
  person: "Person",
  feature: "Feature",
  task: "Task",
  decision: "Decision",
  question: "Question",
};

function GraphLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="12" cy="18" r="3" />
      <line x1="8.5" y1="7.5" x2="10.5" y2="16" />
      <line x1="15.5" y1="7.5" x2="13.5" y2="16" />
    </svg>
  );
}

function EntityCard(props: EntityCardProps) {
  const navigateToGraph = useViewState((s) => s.navigateToGraph);

  function handleGraphClick() {
    if (!props.entityId) return;
    navigateToGraph(props.entityId);
    window.location.pathname = "/graph";
  }

  return (
    <article className="entity-card">
      <div className="entity-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span className="entity-kind">{kindLabelByKind[props.kind]}</span>
          {props.category ? <CategoryBadge category={props.category} /> : undefined}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          {props.entityId ? (
            <button
              type="button"
              className="entity-card-graph-link"
              title="View in graph"
              onClick={handleGraphClick}
            >
              <GraphLinkIcon />
            </button>
          ) : undefined}
          <span className="entity-status">{props.status}</span>
        </div>
      </div>
      <p className="entity-name">{props.name}</p>
      <p className="entity-confidence">Confidence {props.confidence.toFixed(2)}</p>
    </article>
  );
}

function ExtractionSummary(props: ExtractionSummaryProps) {
  return (
    <section className="extraction-summary">
      <p className="extraction-summary-title">{props.title}</p>
      <div className="extraction-summary-grid">
        {props.entities.map((entity) => (
          <EntityCard
            key={`${entity.kind}:${entity.name.toLowerCase()}`}
            kind={entity.kind}
            name={entity.name}
            confidence={entity.confidence}
            status={entity.status}
            entityId={entity.entityId}
            category={entity.category}
          />
        ))}
      </div>
      <p className="extraction-summary-meta">{props.relationshipCount} high-confidence relationships detected</p>
    </section>
  );
}

type WorkItemStatus = "pending" | "accepting" | "accepted" | "dismissed";

async function acceptWorkItem(
  workspaceId: string,
  item: WorkItemSuggestionProps,
): Promise<{ entityId: string }> {
  const response = await fetch(`/api/workspaces/${workspaceId}/work-items/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: item.kind,
      title: item.title,
      rationale: item.rationale,
      ...(item.project ? { project: item.project } : {}),
      ...(item.priority ? { priority: item.priority } : {}),
      ...(item.category ? { category: item.category } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`accept failed: ${response.status}`);
  }
  return response.json();
}

function WorkItemSuggestion(props: WorkItemSuggestionProps) {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [status, setStatus] = useState<WorkItemStatus>("pending");

  async function handleAccept() {
    if (!workspaceId || status !== "pending") return;
    setStatus("accepting");
    try {
      await acceptWorkItem(workspaceId, props);
      setStatus("accepted");
    } catch {
      setStatus("pending");
    }
  }

  function handleDismiss() {
    setStatus("dismissed");
  }

  if (status === "dismissed") return undefined;

  const isDuplicate = props.possibleDuplicateId !== undefined;

  return (
    <article className={`work-item-suggestion ${status === "accepted" ? "work-item-suggestion--accepted" : ""}`}>
      <div className="work-item-suggestion-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span className="entity-kind">{props.kind === "task" ? "Task" : "Feature"}</span>
          {props.category ? <CategoryBadge category={props.category} /> : undefined}
          {props.priority ? <span className="work-item-priority">{props.priority}</span> : undefined}
        </div>
        {status === "accepted" ? (
          <span className="work-item-accepted-badge">Accepted</span>
        ) : (
          <div className="work-item-actions">
            <button
              type="button"
              className="work-item-btn work-item-btn--accept"
              onClick={handleAccept}
              disabled={status === "accepting"}
            >
              {status === "accepting" ? "..." : "Accept"}
            </button>
            <button
              type="button"
              className="work-item-btn work-item-btn--dismiss"
              onClick={handleDismiss}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      <p className="entity-name">{props.title}</p>
      <p className="work-item-rationale">{props.rationale}</p>
      {isDuplicate ? (
        <p className="work-item-duplicate-hint">
          Similar to existing: {props.possibleDuplicateName} ({((props.possibleDuplicateSimilarity ?? 0) * 100).toFixed(0)}% match)
        </p>
      ) : undefined}
      {props.project ? <p className="work-item-project">Project: {props.project}</p> : undefined}
    </article>
  );
}

function WorkItemSuggestionList(props: WorkItemSuggestionListProps) {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const [allStatus, setAllStatus] = useState<"idle" | "accepting">("idle");
  const [dismissedAll, setDismissedAll] = useState(false);

  async function handleAcceptAll() {
    if (!workspaceId || allStatus === "accepting") return;
    setAllStatus("accepting");
    try {
      await Promise.all(props.items.map((item) => acceptWorkItem(workspaceId, item)));
    } catch {
      // individual items handle their own state
    }
    setAllStatus("idle");
  }

  function handleDismissAll() {
    setDismissedAll(true);
  }

  if (dismissedAll) return undefined;

  return (
    <section className="work-item-suggestion-list">
      <div className="work-item-suggestion-list-header">
        <p className="extraction-summary-title">{props.title}</p>
        <div className="work-item-actions">
          <button
            type="button"
            className="work-item-btn work-item-btn--accept"
            onClick={handleAcceptAll}
            disabled={allStatus === "accepting"}
          >
            {allStatus === "accepting" ? "Accepting..." : "Accept All"}
          </button>
          <button
            type="button"
            className="work-item-btn work-item-btn--dismiss"
            onClick={handleDismissAll}
          >
            Dismiss All
          </button>
        </div>
      </div>
      <div className="extraction-summary-grid">
        {props.items.map((item) => (
          <WorkItemSuggestion key={`${item.kind}:${item.title}`} {...item} />
        ))}
      </div>
    </section>
  );
}

export const chatComponentCatalog = componentCatalog({
  EntityCard: {
    ...chatComponentDefinitions.EntityCard,
    component: EntityCard as any,
  },
  ExtractionSummary: {
    ...chatComponentDefinitions.ExtractionSummary,
    component: ExtractionSummary as any,
  },
  WorkItemSuggestion: {
    ...chatComponentDefinitions.WorkItemSuggestion,
    component: WorkItemSuggestion as any,
  },
  WorkItemSuggestionList: {
    ...chatComponentDefinitions.WorkItemSuggestionList,
    component: WorkItemSuggestionList as any,
  },
  InlineRelationshipGraph: {
    ...chatComponentDefinitions.InlineRelationshipGraph,
    component: InlineRelationshipGraph as any,
  },
});
