import { generateObject } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { z } from "zod";
import type { EntityKind, OnboardingState } from "../../shared/contracts";
import { chatComponentSystemPrompt } from "../chat/chat-component-system-prompt";
import { normalizeName } from "../extraction/normalize";
import { logWarn } from "../http/observability";
import { loadOnboardingSummary } from "./onboarding-state";

type MessageContextRow = {
  id: RecordId<"message", string>;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
  suggestions?: string[];
};

type SuggestionGroundingInput = {
  latestEntities: Array<{ kind: EntityKind; text: string; confidence: number }>;
  latestTools: string[];
  latestUserText: string;
};

export type SuggestionGroundingAnchor = {
  value: string;
  normalized: string;
  source: "tool" | "entity" | "user_term" | "user_phrase";
};

const assistantReplySchema = z.object({
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)).max(3),
});

const suggestionStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "with",
  "you",
  "your",
]);

const blockedGenericSuggestionTemplates = [
  "list key team members",
  "describe current project",
  "describe current projects",
  "identify biggest bottleneck",
];

export async function generateOnboardingAssistantReply(input: {
  assistantModel: any;
  surreal: Surreal;
  onboardingState: OnboardingState;
  contextRows: MessageContextRow[];
  latestUserText: string;
  workspaceRecord: RecordId<"workspace", string>;
  latestEntities: Array<{ kind: EntityKind; text: string; confidence: number }>;
  latestTools: string[];
}): Promise<{ message: string; suggestions: string[] }> {
  const suggestionAnchors = buildSuggestionGroundingAnchors({
    latestEntities: input.latestEntities,
    latestTools: input.latestTools,
    latestUserText: input.latestUserText,
  });

  let systemPrompt = [
    "You are helping a product team capture actionable project state. Respond concisely with clear next actions.",
    "",
    "## UI Components",
    chatComponentSystemPrompt,
  ].join("\n");

  if (input.onboardingState === "active") {
    const summary = await loadOnboardingSummary(input.surreal, input.workspaceRecord);
    systemPrompt = [
      "You are onboarding a newly created workspace.",
      "Ask one natural question at a time like a smart colleague, never as a form.",
      "Cover these topics over 5-7 turns: business/venture, current projects, people involved, most important decision, tools used, biggest bottleneck.",
      "Keep acknowledgment to one sentence max.",
      "Reference at least one specific extracted entity or tool from the latest extraction context by name.",
      "Ask exactly one concrete follow-up question in every response.",
      "Do not produce generic praise or encouragement without a grounded follow-up question.",
      "Confirm captured entities inline in plain language.",
      "Generate up to 3 short clickable follow-up suggestions that move onboarding forward.",
      "Each suggestion must reference at least one current-turn grounding anchor.",
      "Do not dump all questions at once.",
      "Current extracted context:",
      summary,
      "Current-turn suggestion grounding anchors:",
      formatSuggestionAnchors(suggestionAnchors),
      "",
      "## UI Components",
      chatComponentSystemPrompt,
    ].join("\n");
  }

  if (input.onboardingState === "summary_pending") {
    const summary = await loadOnboardingSummary(input.surreal, input.workspaceRecord);
    systemPrompt = [
      "You are finishing onboarding for a workspace.",
      "Summarize what has been captured in a concise bullet list and ask if anything is missing or incorrect.",
      "End with an invitation to proceed into normal chat.",
      "Generate up to 3 short clickable follow-up suggestions.",
      "Each suggestion must reference at least one current-turn grounding anchor.",
      "Current extracted context:",
      summary,
      "Current-turn suggestion grounding anchors:",
      formatSuggestionAnchors(suggestionAnchors),
      "",
      "## UI Components",
      chatComponentSystemPrompt,
    ].join("\n");
  }

  const assistantResponse = await generateObject({
    model: input.assistantModel,
    schema: assistantReplySchema,
    system: systemPrompt,
    prompt: [
      "Return JSON with this shape: { message: string, suggestions: string[] }.",
      "Message may include markdown and ```component fenced JSON when useful.",
      "Suggestions must be short and actionable. Do not include numbering or punctuation-only entries.",
      "Each suggestion must include wording from the latest user turn's entities, tools, or message terms.",
      "Drop generic suggestions that are not grounded in the latest user turn.",
      "Conversation context:",
      formatContextRows(input.contextRows),
      "",
      "Latest extraction context:",
      formatLatestExtractionContext(input.latestEntities, input.latestTools),
      "",
      "Grounding anchors (must reference at least one per suggestion):",
      formatSuggestionAnchors(suggestionAnchors),
      "",
      "Latest user message:",
      input.latestUserText,
    ].join("\n"),
  });

  let assistantText = assistantResponse.object.message.trim();
  if (assistantText.length === 0) {
    throw new Error("assistant response was empty");
  }

  if (input.onboardingState === "active") {
    const enforced = enforceActiveOnboardingReply(assistantText, input.latestEntities, input.latestTools);
    if (enforced.corrected) {
      logWarn("onboarding.reply.corrected", "Corrected onboarding assistant reply that failed quality guard", {
        reason: enforced.reason,
      });
      assistantText = enforced.message;
    }
  }

  const normalizedGeneratedSuggestions = [...new Set(assistantResponse.object.suggestions.map((value) => value.trim()))]
    .filter((value) => value.length > 0);
  const suggestions = filterGroundedSuggestions({
    suggestions: normalizedGeneratedSuggestions,
    anchors: suggestionAnchors,
  });
  if (suggestions.length < normalizedGeneratedSuggestions.length) {
    logWarn("onboarding.suggestions.filtered", "Dropped onboarding suggestions that were not grounded in latest turn", {
      onboardingState: input.onboardingState,
      generatedCount: normalizedGeneratedSuggestions.length,
      groundedCount: suggestions.length,
      droppedCount: normalizedGeneratedSuggestions.length - suggestions.length,
    });
  }

  return {
    message: assistantText,
    suggestions,
  };
}

export function buildSuggestionGroundingAnchors(input: SuggestionGroundingInput): SuggestionGroundingAnchor[] {
  const anchors = new Map<string, SuggestionGroundingAnchor>();

  for (const tool of input.latestTools) {
    addSuggestionAnchor(anchors, tool, "tool");
  }

  for (const entity of input.latestEntities.slice().sort((a, b) => b.confidence - a.confidence)) {
    addSuggestionAnchor(anchors, entity.text, "entity");
  }

  for (const term of extractUserMessageGroundingTerms(input.latestUserText)) {
    addSuggestionAnchor(anchors, term.value, term.source);
  }

  return [...anchors.values()].slice(0, 20);
}

export function filterGroundedSuggestions(input: {
  suggestions: string[];
  anchors: SuggestionGroundingAnchor[];
  limit?: number;
}): string[] {
  const dedupedSuggestions = [...new Set(input.suggestions.map((value) => value.trim()))].filter((value) =>
    value.length > 0 && !isBlockedGenericSuggestion(value)
  );
  if (input.anchors.length === 0) {
    return [];
  }

  return dedupedSuggestions
    .filter((suggestion) => hasStrongSuggestionGrounding(suggestion, input.anchors))
    .slice(0, input.limit ?? 3);
}

function formatSuggestionAnchors(anchors: SuggestionGroundingAnchor[]): string {
  if (anchors.length === 0) {
    return "(none)";
  }

  return anchors.map((anchor) => `- ${anchor.value}`).join("\n");
}

function addSuggestionAnchor(
  anchors: Map<string, SuggestionGroundingAnchor>,
  value: string,
  source: SuggestionGroundingAnchor["source"],
): void {
  const trimmedValue = value.trim();
  if (trimmedValue.length < 3) {
    return;
  }

  const normalizedValue = normalizeName(trimmedValue);
  if (normalizedValue.length < 3 || anchors.has(normalizedValue)) {
    return;
  }

  anchors.set(normalizedValue, {
    value: trimmedValue,
    normalized: normalizedValue,
    source,
  });
}

function extractUserMessageGroundingTerms(text: string): Array<{
  value: string;
  source: "user_term" | "user_phrase";
}> {
  const normalizedText = normalizeName(text);
  if (normalizedText.length === 0) {
    return [];
  }

  const tokens = normalizedText
    .split(" ")
    .filter((token) => token.length >= 4 && !suggestionStopWords.has(token))
    .slice(0, 20);

  const terms: Array<{ value: string; source: "user_term" | "user_phrase" }> = tokens.map((value) => ({
    value,
    source: "user_term",
  }));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const phrase = `${tokens[index]} ${tokens[index + 1]}`;
    if (phrase.length >= 9) {
      terms.push({
        value: phrase,
        source: "user_phrase",
      });
    }
    if (terms.length >= 32) {
      break;
    }
  }

  return terms;
}

function hasStrongSuggestionGrounding(
  suggestion: string,
  anchors: SuggestionGroundingAnchor[],
): boolean {
  const normalizedSuggestion = normalizeName(suggestion);
  if (normalizedSuggestion.length === 0) {
    return false;
  }

  const matchedAnchors = anchors.filter((anchor) => normalizedSuggestion.includes(anchor.normalized));
  if (matchedAnchors.length === 0) {
    return false;
  }

  if (matchedAnchors.some((anchor) => anchor.source === "tool" || anchor.source === "entity")) {
    return true;
  }

  if (matchedAnchors.some((anchor) => anchor.source === "user_phrase")) {
    return true;
  }

  const uniqueUserTermMatches = new Set(
    matchedAnchors
      .filter((anchor) => anchor.source === "user_term")
      .map((anchor) => anchor.normalized),
  );
  return uniqueUserTermMatches.size >= 2;
}

function isBlockedGenericSuggestion(value: string): boolean {
  const normalizedValue = normalizeName(value);
  return blockedGenericSuggestionTemplates.some((template) =>
    normalizedValue === template || normalizedValue.startsWith(`${template} `)
  );
}

function formatContextRows(rows: MessageContextRow[]): string {
  if (rows.length === 0) {
    return "(no prior messages)";
  }

  return rows.map((row) => `${row.role.toUpperCase()}: ${row.text}`).join("\n");
}

function formatLatestExtractionContext(
  entities: Array<{ kind: EntityKind; text: string; confidence: number }>,
  tools: string[],
): string {
  const entityLines = entities
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((entity) => `${entity.kind}: ${entity.text} (${entity.confidence.toFixed(2)})`);
  const toolLines = tools.slice(0, 10).map((tool) => `tool: ${tool}`);
  const lines = [...entityLines, ...toolLines];
  return lines.length > 0 ? lines.join("\n") : "(no extracted entities or tools)";
}

function enforceActiveOnboardingReply(
  message: string,
  entities: Array<{ kind: EntityKind; text: string; confidence: number }>,
  tools: string[],
): { message: string; corrected: boolean; reason?: string } {
  const groundingTerm = selectGroundingReference(entities, tools);
  const questionCount = [...message].filter((char) => char === "?").length;
  const hasGroundingReference = groundingTerm ? includesGroundingReference(message, [groundingTerm]) : true;

  if (questionCount === 1 && hasGroundingReference) {
    return { message, corrected: false };
  }

  const reason = questionCount !== 1
    ? "reply did not contain exactly one follow-up question"
    : "reply did not reference extracted entity or tool";
  const base = message.replace(/\?/g, ".").trim();
  const groundedPrefix = hasGroundingReference || !groundingTerm ? "" : `I captured ${groundingTerm}. `;
  const followUp = buildOnboardingFollowUpQuestion(groundingTerm);
  return {
    message: `${groundedPrefix}${base} ${followUp}`.trim(),
    corrected: true,
    reason,
  };
}

function selectGroundingReference(
  entities: Array<{ kind: EntityKind; text: string; confidence: number }>,
  tools: string[],
): string | undefined {
  const tool = tools.find((value) => value.trim().length >= 3);
  if (tool) {
    return tool.trim();
  }

  const topEntity = entities
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .find((entity) => entity.text.trim().length >= 3);
  return topEntity?.text.trim();
}

function includesGroundingReference(message: string, refs: string[]): boolean {
  const normalizedMessage = normalizeName(message);
  const normalizedRefs = refs.map((value) => normalizeName(value)).filter((value) => value.length >= 3);
  if (normalizedRefs.length === 0) {
    return true;
  }
  return normalizedRefs.some((value) => normalizedMessage.includes(value));
}

function buildOnboardingFollowUpQuestion(groundingTerm?: string): string {
  if (!groundingTerm) {
    return "What should we capture next to move onboarding forward?";
  }
  return `What's the current status of ${groundingTerm}?`;
}
