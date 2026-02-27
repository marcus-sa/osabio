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
  expectedResolvedFromContextIndex?: number;
  forbiddenContextOnlyPhrases?: string[];
  expectedEntities: ExpectedEntity[];
  expectedTools?: string[];
  forbiddenTools?: string[];
  forbiddenExtractedKinds?: ExpectedEntityKind[];
};

export type ExtractionEvalOutput = {
  caseId: string;
  input: string;
  userMessageId: string;
  contextMessageIds: string[];
  extractedEntities: Array<{ kind: string; text: string; confidence: number }>;
  extractedTools: string[];
  personCount: number;
  ownerPersonCount: number;
  evidenceRows: Array<{
    evidence?: string;
    fromText?: string;
    model?: string;
    evidenceSourceId?: string;
    resolvedFromId?: string;
  }>;
};

export type SuggestionGoldenCase = {
  id: string;
  input: string;
  requiredAnchors: string[];
  expectedMinSuggestions?: number;
  forbiddenSuggestions?: string[];
};

export type SuggestionsEvalOutput = {
  caseId: string;
  input: string;
  assistantText: string;
  suggestions: string[];
};
