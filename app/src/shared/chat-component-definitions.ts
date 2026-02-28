import { z } from "zod";

export const extractableKindSchema = z.enum(["project", "person", "feature", "task", "decision", "question"]);

export const entityCardPropsSchema = z.object({
  kind: extractableKindSchema,
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: z.string().min(1),
  entityId: z.string().optional(),
});

export const extractionSummaryPropsSchema = z.object({
  title: z.string().min(1),
  entities: z.array(entityCardPropsSchema).min(1),
  relationshipCount: z.number().int().min(0),
});

export type ExtractableKind = z.infer<typeof extractableKindSchema>;
export type EntityCardProps = z.infer<typeof entityCardPropsSchema>;
export type ExtractionSummaryProps = z.infer<typeof extractionSummaryPropsSchema>;

export const chatComponentDefinitions = {
  EntityCard: {
    description: "Renders one extracted entity card with kind, name, status, and confidence.",
    props: entityCardPropsSchema,
  },
  ExtractionSummary: {
    description: "Renders a batch of extracted entities and the relationship count.",
    props: extractionSummaryPropsSchema,
  },
} as const;
