import { componentCatalog } from "reachat";
import type { ExtractableKind } from "../shared/chat-component-definitions";
import {
  chatComponentDefinitions,
  type EntityCardProps,
  type ExtractionSummaryProps,
} from "../shared/chat-component-definitions";
import { CategoryBadge } from "./components/graph/CategoryBadge";
import { useViewState } from "./stores/view-state";

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

export const chatComponentCatalog = componentCatalog({
  EntityCard: {
    ...chatComponentDefinitions.EntityCard,
    component: EntityCard as any,
  },
  ExtractionSummary: {
    ...chatComponentDefinitions.ExtractionSummary,
    component: ExtractionSummary as any,
  },
});
