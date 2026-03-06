import { generateObject } from "ai";
import { RecordId, type Surreal } from "surrealdb";
import { z } from "zod";
import type { EntityKind, OnboardingState } from "../../shared/contracts";
import { loadOnboardingSummary } from "./onboarding-state";

type MessageContextRow = {
  id: RecordId<"message", string>;
  role: "user" | "assistant";
  text: string;
  createdAt: Date | string;
  suggestions?: string[];
};

const assistantReplySchema = z.object({
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)).max(3),
});

export async function generateOnboardingAssistantReply(input: {
  chatAgentModel: any;
  surreal: Surreal;
  onboardingState: OnboardingState;
  contextRows: MessageContextRow[];
  latestUserText: string;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceDescription?: string;
  latestEntities: Array<{ kind: EntityKind; text: string; confidence: number }>;
  latestTools: string[];
}): Promise<{ message: string; suggestions: string[] }> {
  const suggestionAnchors = buildSuggestionAnchors(input.latestUserText, input.latestEntities, input.latestTools);
  const suggestionQualityRules = [
    "You are helping a product team capture actionable project state.",
    "Suggestion quality rules:",
    "- Suggestions are 0-3 short clickable strings.",
    "- Mandatory algorithm:",
    "  1) Build candidate anchors by copying exact phrases from latest user message or latest extraction context.",
    "  2) Prefer concrete anchors: person names, tool names, feature/task phrases (for example SurrealDB, GitHub commit awareness, Slack ingestion, schemafull constraints, onboarding prompts).",
    "  3) Use only anchors from the provided 'Allowed suggestion anchors' list.",
    "  4) If the allowed anchor list is empty, return suggestions: [].",
    "  5) Every suggestion must include at least one allowed anchor phrase verbatim.",
    "  6) Suggestions must ask about next-step details (risk, sequencing, ownership, scope, dependency, rollout, validation) for that anchor.",
    "  7) Never ask for unrelated generic onboarding info (team/business/project overviews) unless that exact wording exists in allowed anchors.",
    "- Never output generic suggestions detached from latest context.",
    "- Forbidden generic suggestions or equivalents:",
    "  - Describe current projects",
    "  - Describe your current project",
    "  - List key team members",
    "  - Identify biggest bottleneck",
    "  - Tell me about your business",
    "  - Tell me about the overall project",
    "  - Describe the business for these tasks",
    "  - Explain the context of these tasks",
    "- Low-signal turn rule: if latest user message is only filler/acknowledgment (for example 'ok', 'sounds good', 'ok and to be'), return suggestions: [].",
    "- Example input: Marcus is driving extraction, Dana is reviewing schemafull constraints, and we're refining onboarding prompts.",
    "- Good suggestions: What risk should Dana prioritize in schemafull constraints? | What is the next milestone for onboarding prompts? | What dependency is blocking extraction work for Marcus?",
    "- Bad suggestions: Tell me about the overall project | Describe the business for these tasks",
    "- Example input: We're building ... with SurrealDB, cross-project conflict detection, GitHub commit awareness, and Slack ingestion.",
    "- Good suggestions: Which risk is highest for SurrealDB this week? | Should GitHub commit awareness ship before Slack ingestion? | What test validates cross-project conflict detection?",
    "- Example input: ok and to be",
    "- Good suggestions: []",
  ].join("\n");

  let systemPrompt = [
    suggestionQualityRules,
    "",
    "Respond concisely with clear next actions.",
  ].join("\n");

  if (input.onboardingState === "active") {
    const summary = await loadOnboardingSummary(input.surreal, input.workspaceRecord);
    const topicList = input.workspaceDescription
      ? "projects and product areas, people involved, most important decision, tools used, biggest bottleneck."
      : "business/venture, current projects, people involved, most important decision, tools used, biggest bottleneck.";
    systemPrompt = [
      suggestionQualityRules,
      "",
      "You are onboarding a newly created workspace.",
      ...(input.workspaceDescription
        ? [`The workspace is already described as: "${input.workspaceDescription}"`, "Do not ask what the business or workspace is about — focus on discovering projects and product areas within it."]
        : []),
      "Ask one natural question at a time like a smart colleague, never as a form.",
      `Cover these topics over 5-7 turns: ${topicList}`,
      "Keep acknowledgment to one sentence max.",
      "Ask exactly one concrete follow-up question in every response.",
      "Confirm captured entities inline in plain language.",
      "Generate up to 3 short clickable follow-up suggestions.",
      "Apply the Suggestion quality rules exactly.",
      "Do not use generic onboarding-checklist suggestions.",
      "Current extracted context:",
      summary,
    ].join("\n");
  }

  if (input.onboardingState === "summary_pending") {
    const summary = await loadOnboardingSummary(input.surreal, input.workspaceRecord);
    systemPrompt = [
      suggestionQualityRules,
      "",
      "You are finishing onboarding for a workspace.",
      "Summarize what has been captured in a concise bullet list.",
      "Ask the user to choose one of two explicit actions:",
      "- Looks good, let's go",
      "- I want to add more",
      "Generate up to 3 short clickable follow-up suggestions.",
      "Apply the Suggestion quality rules exactly.",
      "Do not use generic onboarding-checklist suggestions.",
      "Current extracted context:",
      summary,
    ].join("\n");
  }

  const assistantResponse = await generateObject({
    model: input.chatAgentModel,
    schema: assistantReplySchema,
    system: systemPrompt,
    prompt: [
      "Return JSON with this shape: { message: string, suggestions: string[] }.",
      "Message may include markdown and ```component fenced JSON when useful.",
      "Suggestions must be short and actionable, plain strings only.",
      "When in doubt, prefer suggestions: [] over generic suggestions.",
      "Conversation context:",
      formatContextRows(input.contextRows),
      "",
      "Allowed suggestion anchors (suggestions must include at least one verbatim):",
      formatSuggestionAnchors(suggestionAnchors),
      "",
      "Latest extraction context:",
      formatLatestExtractionContext(input.latestEntities, input.latestTools),
      "",
      "Latest user message:",
      input.latestUserText,
    ].join("\n"),
  });

  const assistantText = assistantResponse.object.message.trim();
  if (assistantText.length === 0) {
    throw new Error("assistant response was empty");
  }

  const firstPassSuggestions = sanitizeSuggestions(assistantResponse.object.suggestions, 3);

  return {
    message: assistantText,
    suggestions: keepSuggestionsWithAnchors(firstPassSuggestions, suggestionAnchors),
  };
}

function sanitizeSuggestions(suggestions: string[], limit: number): string[] {
  return [...new Set(suggestions.map((value) => value.trim()))]
    .filter((value) => value.length > 0 && value.length <= 140)
    .slice(0, limit);
}

function buildSuggestionAnchors(
  latestUserText: string,
  entities: Array<{ kind: EntityKind; text: string; confidence: number }>,
  tools: string[],
): string[] {
  const anchors = [...tools, ...entities.map((entity) => entity.text)];
  const properNouns = [
    ...(latestUserText.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []),
    ...entities.flatMap((entity) => entity.text.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []),
  ];

  anchors.push(...properNouns);
  return [...new Set(anchors.map((value) => value.trim()))]
    .filter((value) => value.length >= 3)
    .slice(0, 12);
}

function formatSuggestionAnchors(anchors: string[]): string {
  if (anchors.length === 0) {
    return "(none)";
  }

  return anchors.map((anchor) => `- ${anchor}`).join("\n");
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

function keepSuggestionsWithAnchors(suggestions: string[], anchors: string[]): string[] {
  if (anchors.length === 0) {
    return [];
  }

  return suggestions.filter((suggestion) => includesAnyAnchor(suggestion, anchors));
}

function includesAnyAnchor(suggestion: string, anchors: string[]): boolean {
  const normalizedSuggestion = normalizeForAnchorMatch(suggestion);
  for (const anchor of anchors) {
    const normalizedAnchor = normalizeForAnchorMatch(anchor);
    if (normalizedAnchor.length === 0) {
      continue;
    }
    if (normalizedSuggestion.includes(normalizedAnchor)) {
      return true;
    }
  }

  return false;
}

function normalizeForAnchorMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
