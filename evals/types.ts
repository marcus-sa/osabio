export type ExpectedEntity = {
  kind: "project" | "person" | "feature" | "task" | "decision" | "question";
  text: string;
};

export type GoldenCase = {
  id: string;
  input: string;
  expectedEntities: ExpectedEntity[];
};

export type ExtractionEvalOutput = {
  caseId: string;
  input: string;
  extractedEntities: Array<{ kind: string; text: string; confidence: number }>;
  personCount: number;
  ownerPersonCount: number;
  evidenceRows: Array<{ evidence?: string; fromText?: string; model?: string }>;
};
