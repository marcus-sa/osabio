type ExpectedEntityKind = "project" | "person" | "feature" | "task" | "decision" | "question";

export type ExpectedEntity =
  | {
      kind: ExpectedEntityKind;
      text: string;
      text_contains?: never;
      expectedCategory?: string;
      expectedPriority?: string;
    }
  | {
      kind: ExpectedEntityKind;
      text?: never;
      text_contains: string;
      expectedCategory?: string;
      expectedPriority?: string;
    };

export type GoldenCaseIntent = "strict_single" | "multi_allowed";

export type ExpectedRelation = {
  from_kind: ExpectedEntityKind;
  to_kind: ExpectedEntityKind;
  to_text_contains: string;
};

export type WorkspaceSeedItem = {
  kind: ExpectedEntityKind;
  text: string;
};

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
  workspace_name?: string;
  workspace_seed?: WorkspaceSeedItem[];
  expectedRelations?: ExpectedRelation[];
};

export type ExtractionEvalOutput = {
  caseId: string;
  input: string;
  userMessageId: string;
  contextMessageIds: string[];
  extractedEntities: Array<{ kind: string; text: string; confidence: number; category?: string; priority?: string }>;
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
  extractedRelations: Array<{
    kind: string;
    fromKind: string;
    fromText: string;
    toKind: string;
    toText: string;
    confidence: number;
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

export type ChatAgentTestCase = {
  id: string;
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; text: string }>;
  expectsToolUse: boolean;
  expectedTools?: string[];
  forbiddenTools?: string[];
  forbiddenResponsePatterns?: string[];
  expectedResponseContains?: string[];
  expectedFacts?: string;
};

export type ChatAgentEvalOutput = {
  caseId: string;
  userMessage: string;
  responseText: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  toolNames: string[];
  success: boolean;
  error?: string;
};

// ---------------------------------------------------------------------------
// Observer LLM Reasoning Eval Types
// ---------------------------------------------------------------------------

export type ObserverLlmTestCase = {
  id: string;
  /** What kind of LLM reasoning is being tested */
  evalType: "verification" | "peer_review" | "contradiction_detection" | "anomaly_evaluation";
  /** Human description of the scenario */
  scenario: string;
  /** For verification: which seeded decision-task pair to use */
  seedCaseKey: string;
  /** Expected verdict from the LLM */
  expectedVerdict: "match" | "mismatch" | "inconclusive";
  /** Expected confidence range [min, max] */
  expectedConfidenceRange: [number, number];
  /** Expected severity of the resulting observation */
  expectedSeverity: "info" | "warning" | "conflict";
  /** Substrings expected in the LLM reasoning text */
  expectedReasoningAnchors?: string[];
  /** Substrings that must NOT appear in reasoning */
  forbiddenReasoningPatterns?: string[];
  /** Ground truth for factuality LLM judge */
  expectedFacts?: string;
  /** For contradiction_detection: expected number of contradictions found */
  expectedContradictionCount?: number;
  /** For contradiction_detection: expected decision-task pairs (decision seedKey -> task seedKey) */
  expectedContradictionPairs?: Array<{ decisionKey: string; taskKey: string }>;
  /** For anomaly_evaluation: whether the anomaly should be marked relevant */
  expectedRelevant?: boolean;
};

export type ObserverLlmEvalOutput = {
  caseId: string;
  verdict: string;
  confidence?: number;
  reasoning: string;
  severity: string;
  evidenceRefs: string[];
  success: boolean;
  error?: string;
};
