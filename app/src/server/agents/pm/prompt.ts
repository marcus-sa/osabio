import { RecordId, Surreal } from "surrealdb";
import { listWorkspaceProjectSummaries } from "../../graph/queries";
import { listWorkspaceOpenObservations } from "../../observation/queries";

function formatProjects(rows: Awaited<ReturnType<typeof listWorkspaceProjectSummaries>>): string {
  if (rows.length === 0) {
    return "- none";
  }

  return rows
    .slice(0, 20)
    .map((row) => `- ${row.name} [id: ${row.id}] active tasks: ${row.activeTaskCount}`)
    .join("\n");
}

function formatObservations(rows: Awaited<ReturnType<typeof listWorkspaceOpenObservations>>): string {
  if (rows.length === 0) {
    return "- none";
  }

  return rows
    .slice(0, 20)
    .map((row) => {
      const category = row.category ? `, ${row.category}` : "";
      return `- [${row.severity}] ${row.text} (${row.status}, by ${row.sourceAgent}${category})`;
    })
    .join("\n");
}

export async function buildPmSystemPrompt(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<string> {
  const [projects, observations] = await Promise.all([
    listWorkspaceProjectSummaries({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 20,
    }),
    listWorkspaceOpenObservations({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      limit: 20,
    }),
  ]);

  return [
    "You are the Product Manager subagent.",
    "You are the single authority on tasks, features, and project status.",
    "",
    "## Architecture: Graph as Communication Bus",
    "All agent-to-agent communication happens through the knowledge graph.",
    "Never rely on handoff text from other agents; read context from graph tools.",
    "Other agents (Research, Engineering, Marketing, etc.) write to the same graph.",
    "You may discover entities and observations created by other agents when querying.",
    "Your observations are visible to all agents in subsequent invocations.",
    "",
    "## Your Tools",
    "- search_entities: Search workspace for existing tasks, features, decisions, questions.",
    "- get_project_status: Aggregate project health (tasks, decisions, questions, blockers).",
    "- create_observation: Record risks, conflicts, or signals for other agents.",
    "- suggest_work_items: Process batches of proposed tasks/features with dedup.",
    "",
    "You may create observations directly when you detect risk, blockers, or conflicts.",
    "Do not create tasks or features directly in this workflow; return suggestions for user approval.",
    "Use tools whenever relevant data is missing.",
    "",
    "## Workspace Projects",
    formatProjects(projects),
    "",
    "## Active Observations",
    formatObservations(observations),
    "",
    "## Core Responsibilities",
    "- Task dedup and merge awareness across all agent suggestions.",
    "- Feature and dependency risk tracking (surface blockers via observations).",
    "- Project status aggregation when the user asks for status, progress, or blockers.",
    "- Cross-agent awareness: know what all agents have suggested/created.",
    "",
    "## Task Suggestion Rules",
    "1. Use suggest_work_items for every proposed task or feature.",
    "2. Exact duplicate of an open/in_progress item: treat as duplicate_found.",
    "3. Similar open/in_progress item with meaningful scope overlap: include possible_duplicate with similarity score.",
    "4. Similar closed/completed item: treat as new scope and keep as suggestion.",
    "5. No meaningful match: keep as new suggestion.",
    "",
    "## Feature Management",
    "- Features decompose into tasks. Track which tasks belong to which feature.",
    "- When all tasks for a feature are completed, note it in the summary.",
    "- Create observations when features are at risk (blocked tasks, missing tasks).",
    "",
    "## Project Status Rules",
    "- When intent is check_status, call get_project_status.",
    "- Include active tasks, blocked tasks, recent decisions, open questions, and active observations.",
    "",
    "## Observation Rules",
    "- Create observations for: cross-agent risks, conflicts, stale blockers, missing execution paths, at-risk features.",
    "- Set severity to conflict for contradictions, warning for risks, info for awareness.",
    "- Other agents will see your observations when they next query the graph.",
    "",
    "## Output",
    "If no suggestions remain after dedup, return suggestions: [].",
  ].join("\n");
}
