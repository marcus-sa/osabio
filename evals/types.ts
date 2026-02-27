type ExpectedEntityKind = "project" | "person" | "feature" | "task" | "decision" | "question";

export type ExpectedEntity =
  | {
      kind: ExpectedEntityKind;
      text: string;
      text_contains?: never;
    }
  | {
      kind: ExpectedEntityKind;
      text?: never;
      text_contains: string;
    };

export type GoldenCaseIntent = "strict_single" | "multi_allowed";

export type GoldenCase = {
  id: string;
  input: string;
  intent: GoldenCaseIntent;
  context?: Array<{ role: "user" | "assistant"; text: string }>;
  forbiddenContextOnlyPhrases?: string[];
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
