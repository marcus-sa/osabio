import { componentCatalog } from "reachat";
import { z } from "zod";

const extractableKindSchema = z.enum(["project", "person", "feature", "task", "decision", "question"]);

const entityCardPropsSchema = z.object({
  kind: extractableKindSchema,
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: z.string().min(1),
});

type EntityCardProps = z.infer<typeof entityCardPropsSchema>;

type ExtractionSummaryProps = {
  title: string;
  entities: EntityCardProps[];
  relationshipCount: number;
};

const kindLabelByKind: Record<z.infer<typeof extractableKindSchema>, string> = {
  project: "Project",
  person: "Person",
  feature: "Feature",
  task: "Task",
  decision: "Decision",
  question: "Question",
};

function EntityCard(props: EntityCardProps) {
  return (
    <article className="entity-card">
      <div className="entity-card-header">
        <span className="entity-kind">{kindLabelByKind[props.kind]}</span>
        <span className="entity-status">{props.status}</span>
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
          />
        ))}
      </div>
      <p className="extraction-summary-meta">{props.relationshipCount} high-confidence relationships detected</p>
    </section>
  );
}

export const chatComponentCatalog = componentCatalog({
  EntityCard: {
    description: "Renders one extracted entity card with kind, name, status, and confidence.",
    props: entityCardPropsSchema,
    component: EntityCard as any,
  },
  ExtractionSummary: {
    description: "Renders a batch of extracted entities and the relationship count.",
    props: z.object({
      title: z.string().min(1),
      entities: z.array(entityCardPropsSchema).min(1),
      relationshipCount: z.number().int().min(0),
    }),
    component: ExtractionSummary as any,
  },
});
