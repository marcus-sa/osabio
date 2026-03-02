import { generateObject } from "ai";
import { z } from "zod";
import type { DescriptionEntry, DescriptionTarget } from "./types";

const synthesisOutputSchema = z.object({
  description: z.string().min(1),
});

export async function synthesizeDescription(input: {
  extractionModel: any;
  entityName: string;
  entityType: DescriptionTarget;
  entries: DescriptionEntry[];
}): Promise<string> {
  const entryLines = input.entries
    .map((entry, i) => {
      const sourceLabel = entry.source
        ? `from ${entry.source.table.name}`
        : "";
      return `${i + 1}. ${entry.text}${sourceLabel ? ` (${sourceLabel})` : ""}`;
    })
    .join("\n");

  const result = await generateObject({
    model: input.extractionModel,
    schema: synthesisOutputSchema,
    temperature: 0.1,
    system: [
      "You synthesize entity descriptions from a list of description entries.",
      "Each entry represents a fact or change about the entity.",
      "Produce a single coherent description paragraph that incorporates all entries.",
      "Keep it concise: 1-4 sentences depending on how many entries there are.",
      "If entries contradict each other, prefer the latest (highest numbered) entry.",
      "Do not include entry numbers, reasoning, or metadata in the output.",
    ].join(" "),
    prompt: [
      `Entity type: ${input.entityType}`,
      `Entity name: ${input.entityName}`,
      "",
      "Description entries:",
      entryLines,
    ].join("\n"),
  });

  return (result.object as { description: string }).description;
}
