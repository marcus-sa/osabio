/**
 * Observer agent system prompt builder.
 *
 * OBSERVER_IDENTITY — static domain knowledge used by both the agent loop
 * and the generateObject calls in llm-reasoning.ts.
 *
 * buildObserverSystemPrompt — async builder that composes identity + dynamic
 * workspace context (existing observations) for agent loop invocations.
 */

import { RecordId, Surreal } from "surrealdb";
import { listWorkspaceOpenObservations } from "../../observation/queries";
import { loadActiveLearnings } from "../../learning/loader";
import { formatLearningsSection } from "../../learning/formatter";

// ---------------------------------------------------------------------------
// Static identity — imported by llm-reasoning.ts for generateObject system prompt
// ---------------------------------------------------------------------------

export const OBSERVER_IDENTITY = `You are the Observer agent in Brain, the operating system for autonomous organizations.

Brain is a knowledge graph where projects, decisions, tasks, features, observations, and questions are nodes. Agents (PM, Architect, Coding, Observer) coordinate through the graph — not by messaging each other.

## Your Role
You scan the graph for contradictions, risks, and drift. You create observations that surface signals to humans and other agents.

## Key Domain Concepts
- **Decision**: A confirmed organizational choice (e.g., "use tRPC for all APIs"). Decisions have status: extracted → proposed → provisional → confirmed → superseded.
- **Task**: A unit of work. Tasks belong to projects and should comply with all confirmed decisions in their project.
- **Observation**: A signal you create when you detect a contradiction, risk, or pattern. Severity: conflict (contradiction), warning (risk), info (awareness).
- **belongs_to**: Graph edge linking tasks and decisions to their project.
- **observes**: Graph edge linking an observation to the entities it concerns.

## Verification Principles
- A task that does something a confirmed decision explicitly forbids is a "mismatch" (contradiction).
- A task that follows all relevant decisions is a "match".
- When decisions don't address what the task does, or evidence is ambiguous, the result is "inconclusive".
- Be decisive: if the text clearly shows a contradiction, say mismatch with high confidence. Reserve inconclusive for genuinely unclear cases.

## Observation Rules
- Create observations for: contradictions between decisions and implementations, stale blocked tasks, status drift, cross-project conflicts.
- Set severity to conflict for contradictions, warning for risks, info for awareness.
- Do NOT duplicate existing observations.
- Always link observations to the entity they concern.`;

// ---------------------------------------------------------------------------
// Dynamic workspace context builder
// ---------------------------------------------------------------------------

function formatObservations(rows: Awaited<ReturnType<typeof listWorkspaceOpenObservations>>): string {
  if (rows.length === 0) {
    return "- none";
  }

  return rows
    .slice(0, 30)
    .map((row) => {
      const category = row.category ? `, ${row.category}` : "";
      return `- [${row.severity}] ${row.text} (${row.status}, by ${row.sourceAgent}${category})`;
    })
    .join("\n");
}

/**
 * Composes OBSERVER_IDENTITY + dynamic workspace observations.
 * Used by agent loop invocations (agent.ts). The generateObject calls
 * in llm-reasoning.ts use OBSERVER_IDENTITY directly (no workspace context needed
 * since entity context is provided in the user prompt).
 */
export async function buildObserverSystemPrompt(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<string> {
  const [observations, learningsResult] = await Promise.all([
    listWorkspaceOpenObservations({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 30,
    }),
    // Observer gets constraints + instructions only (no contextEmbedding = no precedents)
    loadActiveLearnings({
      surreal: input.surreal,
      workspaceId: input.workspaceRecord.id as string,
      agentType: "observer_agent",
    }),
  ]);

  const learningsSection = formatLearningsSection(learningsResult.learnings);

  return [
    OBSERVER_IDENTITY,
    "",
    ...(learningsSection ? [learningsSection, ""] : []),
    "## Existing Workspace Observations",
    formatObservations(observations),
  ].join("\n");
}
