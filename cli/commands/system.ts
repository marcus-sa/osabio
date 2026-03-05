import { loadConfig, requireConfig } from "../config";
import { BrainHttpClient } from "../http-client";

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

type WorkspaceOverviewResponse = {
  workspace: { id: string; name: string };
  projects: Array<{
    id: string;
    name: string;
    status: string;
    description?: string;
    counts: { tasks: number; decisions: number; features: number; questions: number };
  }>;
  hot_items: HotItems;
  active_sessions: ActiveSession[];
};

type ContextPacketResponse = {
  workspace: { id: string; name: string };
  project: { id: string; name: string; status: string; description?: string };
  decisions: {
    confirmed: DecisionCtx[];
    provisional: DecisionCtx[];
    contested: DecisionCtx[];
  };
  active_tasks: TaskCtx[];
  open_questions: QuestionCtx[];
  observations: ObservationCtx[];
  pending_suggestions: SuggestionCtx[];
  active_sessions: ActiveSession[];
};

type TaskContextResponse = {
  workspace: { id: string; name: string };
  project: { id: string; name: string; status: string };
  task_scope: {
    task: { id: string; title: string; description?: string; status: string; category?: string };
    subtasks: { id: string; title: string; status: string }[];
    parent_feature?: { id: string; name: string; description?: string };
    sibling_tasks: { id: string; title: string; status: string }[];
    dependencies: { id: string; title: string; status: string }[];
  };
  hot_items: HotItems;
  active_sessions: ActiveSession[];
};

type IntentContextResponse = {
  level: "task" | "project" | "workspace";
  data: TaskContextResponse | ContextPacketResponse | WorkspaceOverviewResponse;
};

type DecisionCtx = { id: string; summary: string; status: string; rationale?: string };
type TaskCtx = { id: string; title: string; status: string; priority?: string; category?: string };
type QuestionCtx = { id: string; text: string; status: string };
type ObservationCtx = { id: string; text: string; severity: string; status: string; category?: string };
type SuggestionCtx = { id: string; text: string; category: string; rationale: string; confidence: number };
type HotItems = {
  contested_decisions: Array<{ id: string; summary: string }>;
  open_observations: Array<{ id: string; text: string; severity: string }>;
  pending_suggestions: Array<{ id: string; text: string; category: string; confidence: number }>;
};
type ActiveSession = {
  id: string;
  agent: string;
  started_at: string;
  task?: { id: string; title: string };
};

// ---------------------------------------------------------------------------
// brain system load-context (SessionStart hook)
// ---------------------------------------------------------------------------

/**
 * brain system load-context
 * Called by SessionStart hook.
 * Single-project workspaces get full project context automatically.
 * Multi-project workspaces get the workspace overview.
 */
export async function runLoadContext(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  try {
    const overview = (await client.getWorkspaceContext()) as WorkspaceOverviewResponse;

    // Single-project shortcut: load full project context
    if (overview.projects.length === 1) {
      const project = overview.projects[0];
      try {
        const projectContext = (await client.getProjectContext({ project_id: project.id })) as ContextPacketResponse;
        console.log(formatProjectContext(projectContext));
        return;
      } catch {
        // Fall back to workspace overview
      }
    }

    console.log(formatWorkspaceOverview(overview));
  } catch (error) {
    console.error(`Failed to load workspace: ${error instanceof Error ? error.message : error}`);
  }
}

// ---------------------------------------------------------------------------
// brain system pretooluse (PreToolUse hook)
// ---------------------------------------------------------------------------

type HookInput = {
  tool_name: string;
  tool_input: Record<string, unknown>;
};

type HookResponse = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    additionalContext: string;
  };
};

/**
 * brain system pretooluse
 * Called by PreToolUse hook. Only acts on Task tool — loads intent-based
 * context and returns as additionalContext (accumulated across hooks).
 */
export async function runPreToolUse(): Promise<void> {
  let input: HookInput;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk));
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf-8").trim());
  } catch {
    return; // Can't parse stdin — passthrough
  }

  if (input.tool_name !== "Task") return; // Only intercept Task tool

  const config = await loadConfig();
  if (!config) return; // Not configured — passthrough

  const client = new BrainHttpClient(config);
  const prompt = typeof input.tool_input.prompt === "string" ? input.tool_input.prompt : "";
  if (!prompt) return;

  try {
    // Extract intent from first 500 chars + detect paths
    const intentText = prompt.slice(0, 500);
    const paths = extractAbsolutePaths(prompt);

    const result = (await client.getContext({
      intent: intentText,
      ...(paths.length > 0 ? { paths } : {}),
    })) as IntentContextResponse;

    const formatted = formatIntentResult(result);
    if (!formatted) return;

    const response: HookResponse = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: formatted,
      },
    };

    console.log(JSON.stringify(response));
  } catch {
    // Silent on error — don't block the agent
  }
}

/** Extract absolute paths from text */
function extractAbsolutePaths(text: string): string[] {
  const matches = text.match(/\/[\w./-]+/g);
  if (!matches) return [];
  // Filter to paths that look like real directories (at least 2 segments)
  return [...new Set(matches.filter((p) => p.split("/").filter(Boolean).length >= 2))];
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatIntentResult(result: IntentContextResponse): string | undefined {
  if (result.level === "project") {
    return formatProjectContext(result.data as ContextPacketResponse);
  }
  if (result.level === "task") {
    return formatTaskContext(result.data as TaskContextResponse);
  }
  if (result.level === "workspace") {
    return formatWorkspaceOverview(result.data as WorkspaceOverviewResponse);
  }
  return undefined;
}

function formatProjectContext(ctx: ContextPacketResponse): string {
  const lines: string[] = [];
  lines.push(`# Brain: ${ctx.project.name} (project: ${ctx.project.id})\n`);

  const { confirmed, provisional, contested } = ctx.decisions;
  if (contested.length > 0) {
    lines.push("## Contested Decisions (need resolution)");
    for (const d of contested) {
      lines.push(`  - [${d.id}] ${d.summary}`);
      if (d.rationale) lines.push(`    Rationale: ${d.rationale}`);
    }
    lines.push("");
  }
  if (confirmed.length > 0) {
    lines.push("## Confirmed Decisions");
    for (const d of confirmed) lines.push(`  - [${d.id}] ${d.summary}`);
    lines.push("");
  }
  if (provisional.length > 0) {
    lines.push("## Provisional Decisions (pending review)");
    for (const d of provisional) lines.push(`  - [${d.id}] ${d.summary}`);
    lines.push("");
  }

  if (ctx.active_tasks.length > 0) {
    lines.push("## Active Tasks");
    for (const t of ctx.active_tasks) {
      const meta = [t.status, t.priority, t.category].filter(Boolean).join(", ");
      lines.push(`  - [${t.id}] ${t.title} (${meta})`);
    }
    lines.push("");
  }

  if (ctx.open_questions.length > 0) {
    lines.push("## Open Questions");
    for (const q of ctx.open_questions) lines.push(`  - [${q.id}] ${q.text}`);
    lines.push("");
  }

  if (ctx.observations.length > 0) {
    lines.push("## Observations");
    for (const o of ctx.observations) lines.push(`  - [${o.severity}] ${o.text}`);
    lines.push("");
  }

  if (ctx.pending_suggestions.length > 0) {
    lines.push("## Pending Suggestions");
    for (const s of ctx.pending_suggestions) lines.push(`  - [${s.category}] ${s.text}`);
    lines.push("");
  }

  formatActiveSessions(lines, ctx.active_sessions);
  lines.push('Use `get_context` MCP tool with a description of your work for more detail.');
  return lines.join("\n");
}

function formatTaskContext(ctx: TaskContextResponse): string {
  const lines: string[] = [];
  const { task } = ctx.task_scope;
  lines.push(`# Brain: Task "${task.title}" (task: ${task.id})`);
  lines.push(`Project: ${ctx.project.name} (project: ${ctx.project.id})`);
  lines.push(`Status: ${task.status}${task.category ? ` | Category: ${task.category}` : ""}`);
  if (task.description) lines.push(`\n${task.description}`);
  lines.push("");

  if (ctx.task_scope.subtasks.length > 0) {
    lines.push("## Subtasks");
    for (const s of ctx.task_scope.subtasks) lines.push(`  - [${s.status}] ${s.title} (${s.id})`);
    lines.push("");
  }

  if (ctx.task_scope.dependencies.length > 0) {
    lines.push("## Dependencies");
    for (const d of ctx.task_scope.dependencies) lines.push(`  - [${d.status}] ${d.title} (${d.id})`);
    lines.push("");
  }

  if (ctx.task_scope.sibling_tasks.length > 0) {
    lines.push("## Sibling Tasks");
    for (const s of ctx.task_scope.sibling_tasks) lines.push(`  - [${s.status}] ${s.title}`);
    lines.push("");
  }

  formatHotItems(lines, ctx.hot_items);
  formatActiveSessions(lines, ctx.active_sessions);
  return lines.join("\n");
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

  formatHotItems(lines, overview.hot_items);
  formatActiveSessions(lines, overview.active_sessions);
  lines.push('Use `get_context` MCP tool with a description of your work to load relevant project context.');
  return lines.join("\n");
}

function formatHotItems(lines: string[], hot: HotItems): void {
  if (hot.contested_decisions.length > 0) {
    lines.push("## Contested Decisions");
    for (const d of hot.contested_decisions) lines.push(`  - ${d.summary} (${d.id})`);
    lines.push("");
  }
  if (hot.open_observations.length > 0) {
    lines.push("## Open Observations");
    for (const o of hot.open_observations) lines.push(`  - [${o.severity}] ${o.text}`);
    lines.push("");
  }
  if (hot.pending_suggestions.length > 0) {
    lines.push("## Pending Suggestions");
    for (const s of hot.pending_suggestions) lines.push(`  - [${s.category}] ${s.text}`);
    lines.push("");
  }
}

function formatActiveSessions(lines: string[], sessions: ActiveSession[]): void {
  if (sessions.length > 0) {
    lines.push("## Active Agent Sessions");
    for (const s of sessions) {
      const taskInfo = s.task ? ` on "${s.task.title}"` : "";
      lines.push(`  - ${s.agent}${taskInfo}`);
    }
    lines.push("");
  }
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
