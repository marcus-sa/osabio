import { z } from "zod";

export const extractionEntitySchema = z.object({
  tempId: z.string().min(1),
  kind: z.enum(["project", "person", "feature", "task", "decision", "question"]),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
});

export const extractionRelationshipSchema = z.object({
  kind: z.string().min(1),
  fromTempId: z.string().min(1),
  toTempId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fromText: z.string().min(1),
  toText: z.string().min(1),
});

export const extractionResultSchema = z.object({
  entities: z.array(extractionEntitySchema),
  relationships: z.array(extractionRelationshipSchema),
  tools: z.array(z.string().min(1)),
});

export type ExtractionPromptEntity = z.infer<typeof extractionEntitySchema>;
export type ExtractionPromptRelationship = z.infer<typeof extractionRelationshipSchema>;
export type ExtractionPromptOutput = z.infer<typeof extractionResultSchema>;

export function parseExtractionOutput(payload: unknown):
  | { ok: true; data: ExtractionPromptOutput }
  | { ok: false; error: string } {
  const result = extractionResultSchema.safeParse(payload);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: result.error.issues[0]?.message ?? "Invalid extraction payload",
  };
}
