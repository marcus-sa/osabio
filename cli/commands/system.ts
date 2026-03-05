import { requireConfig } from "../config";
import { BrainHttpClient } from "../http-client";

type WorkspaceOverviewResponse = {
  workspace: { id: string; name: string };
  projects: Array<{
    id: string;
    name: string;
    status: string;
    description?: string;
    counts: { tasks: number; decisions: number; features: number; questions: number };
  }>;
  hot_items: {
    contested_decisions: Array<{ id: string; summary: string }>;
    open_observations: Array<{ id: string; text: string; severity: string }>;
    pending_suggestions: Array<{ id: string; text: string; category: string; confidence: number }>;
  };
  active_sessions: Array<{
    id: string;
    agent: string;
    started_at: string;
    task?: { id: string; title: string };
  }>;
};

/**
 * brain system load-context
 * Called by SessionStart hook. Loads workspace overview for agent orientation.
 */
export async function runLoadContext(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  try {
    const overview = (await client.getWorkspaceContext()) as WorkspaceOverviewResponse;
    console.log(formatWorkspaceOverview(overview));
  } catch (error) {
    console.error(`Failed to load workspace: ${error instanceof Error ? error.message : error}`);
  }
}

function formatWorkspaceOverview(overview: WorkspaceOverviewResponse): string {
  const lines: string[] = [];

  lines.push(`# Brain Workspace: ${overview.workspace.name}\n`);

  if (overview.projects.length === 0) {
    lines.push("No projects found. Create one in the Brain web UI.");
    return lines.join("\n");
  }

  lines.push("## Projects");
  for (const p of overview.projects) {
    const c = p.counts;
    const counts = `${c.tasks}T ${c.decisions}D ${c.features}F ${c.questions}Q`;
    lines.push(`  - ${p.name} (id: ${p.id}) [${counts}]`);
  }
  lines.push("");

  const { contested_decisions, open_observations, pending_suggestions } = overview.hot_items;

  if (contested_decisions.length > 0) {
    lines.push("## Contested Decisions");
    for (const d of contested_decisions) {
      lines.push(`  - ${d.summary} (id: ${d.id})`);
    }
    lines.push("");
  }

  if (open_observations.length > 0) {
    lines.push("## Open Observations");
    for (const o of open_observations) {
      lines.push(`  - [${o.severity}] ${o.text}`);
    }
    lines.push("");
  }

  if (pending_suggestions.length > 0) {
    lines.push("## Pending Suggestions");
    for (const s of pending_suggestions) {
      lines.push(`  - [${s.category}] ${s.text}`);
    }
    lines.push("");
  }

  if (overview.active_sessions.length > 0) {
    lines.push("## Active Agent Sessions");
    for (const s of overview.active_sessions) {
      const taskInfo = s.task ? ` on "${s.task.title}"` : "";
      lines.push(`  - ${s.agent}${taskInfo}`);
    }
    lines.push("");
  }

  lines.push("Use `get_workspace_context`, `get_project_context`, or `get_task_context` MCP tools for more detail.");

  return lines.join("\n");
}

/**
 * brain system check-updates
 * Called by UserPromptSubmit hook. Workspace-level change alerts.
 */
export async function runCheckUpdates(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  try {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const result = (await client.getChanges({ since })) as {
      changes: Array<{ entity_type: string; entity_name: string; change_type: string; changed_at: string }>;
    };

    if (!result.changes || result.changes.length === 0) return;

    const critical = result.changes.filter(
      (c) => c.change_type === "contested" || c.change_type === "superseded",
    );
    if (critical.length > 0) {
      console.log("\n--- Context Update ---");
      for (const c of critical) {
        console.log(`[${c.entity_type}] ${c.entity_name} — ${c.change_type} at ${c.changed_at}`);
      }
      console.log("--- End Update ---\n");
    }

    const crossAgent = result.changes.filter(
      (c) =>
        c.change_type === "provisional" ||
        (c.entity_type === "observation" && (c.change_type === "warning" || c.change_type === "conflict")),
    );
    if (crossAgent.length > 0) {
      console.log("\n--- Cross-Agent Activity ---");
      for (const c of crossAgent) {
        console.log(`[${c.entity_type}] ${c.entity_name} — ${c.change_type}`);
      }
      console.log("--- End ---\n");
    }

    const newSuggestions = result.changes.filter(
      (c) => c.entity_type === "suggestion" && c.change_type === "pending",
    );
    if (newSuggestions.length > 0) {
      console.log("\n--- New Suggestions ---");
      for (const s of newSuggestions) {
        console.log(`[suggestion] ${s.entity_name}`);
      }
      console.log("--- End ---\n");
    }
  } catch {
    // Silent on error — don't block the user
  }
}

/**
 * brain system end-session
 * Called by SessionEnd hook. Reads the Stop hook JSON from stdin which includes
 * project_id (set by the agent) and session summary.
 */
export async function runEndSession(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  try {
    // Read stdin (Claude Code pipes Stop hook JSON)
    let stdinText = "";
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of Bun.stdin.stream()) {
        chunks.push(Buffer.from(chunk));
      }
      stdinText = Buffer.concat(chunks).toString("utf-8").trim();
    } catch {
      // stdin not available or empty
    }

    if (!stdinText) return;

    const parsed = JSON.parse(stdinText) as Record<string, unknown>;

    if (parsed.decision === "block") {
      const reason = typeof parsed.reason === "string" ? parsed.reason : "Stop hook returned block decision";
      throw new Error(`Session end blocked: ${reason}`);
    }
    if (parsed.decision !== "approve") {
      throw new Error("Stop hook payload must include decision=\"approve\" or decision=\"block\"");
    }
    if (typeof parsed.summary !== "string" || parsed.summary.trim().length === 0) {
      throw new Error("Stop hook payload must include a non-empty string summary");
    }

    // project_id comes from the agent via the Stop hook payload (optional)
    const projectId = typeof parsed.project_id === "string" ? parsed.project_id : undefined;
    const summary = parsed.summary.trim();

    const parseStringArray = (key: string): string[] | undefined => {
      const val = parsed[key];
      if (val === undefined) return undefined;
      if (!Array.isArray(val) || !val.every((v) => typeof v === "string")) {
        throw new Error(`${key} must be an array of strings`);
      }
      return val;
    };

    const decisionsMade = parseStringArray("decisions_made");
    const questionsAsked = parseStringArray("questions_asked");
    const observationsLogged = parseStringArray("observations_logged");
    const subtasksCreated = parseStringArray("subtasks_created");
    const suggestionsCreated = parseStringArray("suggestions_created");

    let tasksProgressed: Array<{ task_id: string; from_status: string; to_status: string }> | undefined;
    if (parsed.tasks_progressed !== undefined) {
      if (!Array.isArray(parsed.tasks_progressed)) throw new Error("tasks_progressed must be an array");
      tasksProgressed = parsed.tasks_progressed.map((entry) => {
        const row = entry as Record<string, unknown>;
        if (typeof row.task_id !== "string" || typeof row.from_status !== "string" || typeof row.to_status !== "string") {
          throw new Error("tasks_progressed entries must include string task_id, from_status, and to_status");
        }
        return { task_id: row.task_id, from_status: row.from_status, to_status: row.to_status };
      });
    }

    let filesChanged: Array<{ path: string; change_type: string }> | undefined;
    if (parsed.files_changed !== undefined) {
      if (!Array.isArray(parsed.files_changed)) throw new Error("files_changed must be an array");
      filesChanged = parsed.files_changed.map((entry) => {
        const row = entry as Record<string, unknown>;
        if (typeof row.path !== "string" || typeof row.change_type !== "string") {
          throw new Error("files_changed entries must include string path and change_type");
        }
        return { path: row.path, change_type: row.change_type };
      });
    }

    // Create session and immediately end it with summary
    const session = await client.sessionStart({
      agent: "claude-code",
      ...(projectId ? { project_id: projectId } : {}),
    });

    await client.sessionEnd({
      session_id: session.session_id,
      summary,
      decisions_made: decisionsMade,
      questions_asked: questionsAsked,
      tasks_progressed: tasksProgressed,
      files_changed: filesChanged,
      observations_logged: observationsLogged,
      subtasks_created: subtasksCreated,
      suggestions_created: suggestionsCreated,
    });
  } catch (error) {
    console.error(`Brain: Failed to end session: ${error instanceof Error ? error.message : error}`);
  }
}
