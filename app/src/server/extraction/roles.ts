export type ExtractionMessageRole = "user" | "assistant" | "system";

export function shouldRunExtractionForRole(role: ExtractionMessageRole): boolean {
  return role === "user";
}
