/**
 * Scope Engine — Pure functions for computing effective tool scope
 * from intent authorization details and classifying tools.
 *
 * Pure core: no IO, no DB, no side effects.
 */
import type { BrainAction } from "../oauth/types";
import type { ResolvedTool } from "../proxy/tool-injector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthorizedIntentSummary = {
  readonly intentId: string;
  readonly authorizationDetails: readonly BrainAction[];
};

export type ToolClassification =
  | { readonly kind: "authorized"; readonly matchingIntent: AuthorizedIntentSummary }
  | { readonly kind: "gated" }
  | { readonly kind: "brain_native" };

export type EffectiveScope = {
  readonly authorizedActions: readonly BrainAction[];
  readonly intents: readonly AuthorizedIntentSummary[];
};

export type ClassifiedTool = {
  readonly tool: ResolvedTool;
  readonly classification: ToolClassification;
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Unions authorization_details from multiple intents into a flat EffectiveScope. */
export function computeEffectiveScope(
  intents: readonly AuthorizedIntentSummary[],
): EffectiveScope {
  const authorizedActions = intents.flatMap(
    (intent) => intent.authorizationDetails,
  );
  return { authorizedActions, intents };
}

/**
 * Build the resource string used for matching actions to tools.
 * Format: `mcp_tool:{toolkit}:{toolName}`
 */
function buildToolResource(toolkit: string, toolName: string): string {
  return `mcp_tool:${toolkit}:${toolName}`;
}

/** Find the first intent whose authorization_details contain a matching resource. */
function findMatchingIntent(
  toolResource: string,
  effectiveScope: EffectiveScope,
): AuthorizedIntentSummary | undefined {
  return effectiveScope.intents.find((intent) =>
    intent.authorizationDetails.some(
      (action) => action.resource === toolResource,
    ),
  );
}

/** Classify a single tool against the effective scope and brain-native set. */
function classifyTool(
  tool: ResolvedTool,
  effectiveScope: EffectiveScope,
  brainNativeToolNames: ReadonlySet<string>,
): ToolClassification {
  if (brainNativeToolNames.has(tool.name)) {
    return { kind: "brain_native" };
  }

  const toolResource = buildToolResource(tool.toolkit, tool.name);
  const matchingIntent = findMatchingIntent(toolResource, effectiveScope);

  if (matchingIntent) {
    return { kind: "authorized", matchingIntent };
  }

  return { kind: "gated" };
}

/**
 * Compute the set of brain write tools that have an approved intent.
 * Checks for resources matching `mcp_tool:brain:{toolName}`.
 */
export function computeAuthorizedBrainWriteTools(
  effectiveScope: EffectiveScope,
  brainWriteToolNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const authorized = new Set<string>();
  for (const toolName of brainWriteToolNames) {
    const resource = `mcp_tool:brain:${toolName}`;
    if (effectiveScope.authorizedActions.some((a) => a.resource === resource)) {
      authorized.add(toolName);
    }
  }
  return authorized;
}

/**
 * Find the first intent whose authorization_details match a brain write tool.
 * Returns the intent summary or undefined if no match.
 */
export function findBrainWriteIntent(
  toolName: string,
  effectiveScope: EffectiveScope,
): AuthorizedIntentSummary | undefined {
  const resource = `mcp_tool:brain:${toolName}`;
  return effectiveScope.intents.find((intent) =>
    intent.authorizationDetails.some((action) => action.resource === resource),
  );
}

/** Classifies each granted tool as authorized, gated, or brain_native. */
export function classifyTools(
  grantedTools: readonly ResolvedTool[],
  effectiveScope: EffectiveScope,
  brainNativeToolNames: ReadonlySet<string>,
): readonly ClassifiedTool[] {
  return grantedTools.map((tool) => ({
    tool,
    classification: classifyTool(tool, effectiveScope, brainNativeToolNames),
  }));
}
