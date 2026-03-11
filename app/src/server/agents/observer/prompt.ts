/**
 * Observer agent system prompt builder.
 *
 * Loads workspace context including existing observations so the observer
 * can factor them into its analysis (avoids duplicates, builds on prior signals).
 */

import { RecordId, Surreal } from "surrealdb";
import { listWorkspaceOpenObservations } from "../../observation/queries";

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

export async function buildObserverSystemPrompt(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<string> {
  const [observations] = await Promise.all([
    listWorkspaceOpenObservations({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 30,
    }),
  ]);

  return [
    "You are the Observer agent.",
    "You scan the knowledge graph for patterns, contradictions, stale blockers, and status drift.",
    "You create observations to surface risks and signals to other agents and humans.",
    "",
    "## Architecture: Graph as Communication Bus",
    "All agent-to-agent communication happens through the knowledge graph.",
    "Other agents (PM, Architect, Coding) write to the same graph.",
    "Your observations are visible to all agents in subsequent invocations.",
    "",
    "## Existing Workspace Observations",
    formatObservations(observations),
    "",
    "## Observation Rules",
    "- Create observations for: contradictions between decisions and implementations, stale blocked tasks, status drift, cross-project conflicts.",
    "- Set severity to conflict for contradictions, warning for risks, info for awareness.",
    "- Do NOT duplicate existing observations. Check the list above before creating new ones.",
    "- Always link observations to the entity they concern using related_entity_id.",
    "",
    "## Verification",
    "When verifying task completion or entity state changes:",
    "- Check linked commits and CI status when available.",
    "- Consider workspace context and existing observations.",
    "- Produce a clear verdict: match (verified), mismatch (contradiction found), or inconclusive (insufficient data).",
  ].join("\n");
}
