import { requireConfig, getDirCacheEntry, setDirCacheEntry, type DirCacheEntry } from "../config";
import { BrainHttpClient } from "../http-client";

/**
 * brain system load-context
 * Called by SessionStart hook. Outputs context as additionalContext text.
 */
export async function runLoadContext(): Promise<void> {
  const config = requireConfig();
  const client = new BrainHttpClient(config);
  const cwd = process.cwd();

  // Check dir cache for cached project
  const cached = getDirCacheEntry(cwd);

  if (cached) {
    // Load context for cached project
    try {
      // Create session first so we can exclude self from active sessions
      let sessionId: string | undefined;
      try {
        const session = await client.sessionStart({
          agent: "claude-code",
          project_id: cached.project_id,
        });
        sessionId = session.session_id;
      } catch {
        // Session creation failure must not break context loading
      }

      const context = await client.getContext({
        project_id: cached.project_id,
        since: cached.last_session,
        session_id: sessionId,
      });

      // Output as text for Claude Code additionalContext
      console.log(formatContextPacket(context));

      setDirCacheEntry(cwd, {
        ...cached,
        session_id: sessionId,
        last_session: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Failed to load context: ${error instanceof Error ? error.message : error}`);
    }
    return;
  }

  // No cached project — list projects for agent inference
  try {
    const projectsResult = await client.getProjects();
    const projects = projectsResult.projects;

    if (projects.length === 0) {
      console.log("No projects found in workspace. Create one in the Brain web UI first.");
      return;
    }

    if (projects.length === 1) {
      // Single project — auto-select
      const project = projects[0];
      const entry: DirCacheEntry = {
        project_id: project.id,
        project_name: project.name,
        last_session: new Date().toISOString(),
      };

      // Create session first so we can exclude self from active sessions
      try {
        const session = await client.sessionStart({
          agent: "claude-code",
          project_id: project.id,
        });
        entry.session_id = session.session_id;
      } catch {
        // Session creation failure must not break context loading
      }

      const context = await client.getContext({
        project_id: project.id,
        session_id: entry.session_id,
      });
      console.log(formatContextPacket(context));

      setDirCacheEntry(cwd, entry);
      return;
    }

    // Multiple projects — output list for agent to select
    console.log(`You're working in: ${cwd}`);
    console.log(`Workspace: ${projectsResult.workspace.name}`);
    console.log(`\nProjects in this workspace:`);
    for (const p of projects) {
      console.log(`  - ${p.name} (id: ${p.id})`);
    }
    console.log(`\nTo set your project for this directory, run:`);
    console.log(`  brain system set-project <project-id>`);
  } catch (error) {
    console.error(`Failed to load projects: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * brain system set-project <project-id>
 * Cache a project for the current directory.
 */
export async function runSetProject(projectId: string): Promise<void> {
  const config = requireConfig();
  const client = new BrainHttpClient(config);
  const cwd = process.cwd();

  const projectsResult = await client.getProjects();
  const project = projectsResult.projects.find((p) => p.id === projectId);

  if (!project) {
    console.error(`Project not found: ${projectId}`);
    console.error("Available projects:");
    for (const p of projectsResult.projects) {
      console.error(`  - ${p.name} (id: ${p.id})`);
    }
    process.exit(1);
  }

  setDirCacheEntry(cwd, {
    project_id: project.id,
    project_name: project.name,
    last_session: new Date().toISOString(),
  });

  console.log(`Project set: ${project.name} (${project.id}) for ${cwd}`);
}

/**
 * brain system check-updates
 * Called by UserPromptSubmit hook. Outputs alerts for critical changes.
 */
export async function runCheckUpdates(): Promise<void> {
  const config = requireConfig();
  const client = new BrainHttpClient(config);
  const cwd = process.cwd();

  const cached = getDirCacheEntry(cwd);
  if (!cached?.last_session) return;

  try {
    const result = (await client.getChanges({
      project_id: cached.project_id,
      since: cached.last_session,
    })) as { changes: Array<{ entity_type: string; entity_name: string; change_type: string; changed_at: string }> };

    if (!result.changes || result.changes.length === 0) return;

    // Check for critical changes
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

    // Cross-agent activity: provisional decisions and observations from other agents
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

    // Update last check time
    setDirCacheEntry(cwd, { ...cached, last_session: new Date().toISOString() });
  } catch {
    // Silent on error — don't block the user
  }
}

/**
 * brain system end-session
 * Called by SessionEnd hook.
 */
export async function runEndSession(): Promise<void> {
  const config = requireConfig();
  const client = new BrainHttpClient(config);
  const cwd = process.cwd();
  const cached = getDirCacheEntry(cwd);

  if (!cached) return; // No project mapped — nothing to end

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

    // Parse the summary payload
    let summary = "Session ended without summary";
    let decisionsMade: string[] | undefined;
    let questionsAsked: string[] | undefined;
    let tasksProgressed: Array<{ task_id: string; from_status: string; to_status: string }> | undefined;
    let filesChanged: Array<{ path: string; change_type: string }> | undefined;
    let observationsLogged: string[] | undefined;

    if (stdinText) {
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
      summary = parsed.summary.trim();

      if (parsed.decisions_made !== undefined) {
        if (!Array.isArray(parsed.decisions_made) || !parsed.decisions_made.every((v) => typeof v === "string")) {
          throw new Error("decisions_made must be an array of string ids");
        }
        decisionsMade = parsed.decisions_made;
      }

      if (parsed.questions_asked !== undefined) {
        if (!Array.isArray(parsed.questions_asked) || !parsed.questions_asked.every((v) => typeof v === "string")) {
          throw new Error("questions_asked must be an array of string ids");
        }
        questionsAsked = parsed.questions_asked;
      }

      if (parsed.tasks_progressed !== undefined) {
        if (!Array.isArray(parsed.tasks_progressed)) {
          throw new Error("tasks_progressed must be an array");
        }
        tasksProgressed = parsed.tasks_progressed.map((entry) => {
          if (!entry || typeof entry !== "object") {
            throw new Error("tasks_progressed entries must be objects");
          }
          const row = entry as Record<string, unknown>;
          if (
            typeof row.task_id !== "string" ||
            typeof row.from_status !== "string" ||
            typeof row.to_status !== "string"
          ) {
            throw new Error("tasks_progressed entries must include string task_id, from_status, and to_status");
          }
          return {
            task_id: row.task_id,
            from_status: row.from_status,
            to_status: row.to_status,
          };
        });
      }

      if (parsed.files_changed !== undefined) {
        if (!Array.isArray(parsed.files_changed)) {
          throw new Error("files_changed must be an array");
        }
        filesChanged = parsed.files_changed.map((entry) => {
          if (!entry || typeof entry !== "object") {
            throw new Error("files_changed entries must be objects");
          }
          const row = entry as Record<string, unknown>;
          if (typeof row.path !== "string" || typeof row.change_type !== "string") {
            throw new Error("files_changed entries must include string path and change_type");
          }
          if (!["created", "modified", "deleted"].includes(row.change_type)) {
            throw new Error("files_changed.change_type must be one of: created, modified, deleted");
          }
          return { path: row.path, change_type: row.change_type };
        });
      }

      if (parsed.observations_logged !== undefined) {
        if (!Array.isArray(parsed.observations_logged) || !parsed.observations_logged.every((v) => typeof v === "string")) {
          throw new Error("observations_logged must be an array of string ids");
        }
        observationsLogged = parsed.observations_logged;
      }
    }

    // Get session_id from cache, or create a session as fallback
    let sessionId = cached.session_id;
    if (!sessionId) {
      const session = await client.sessionStart({
        agent: "claude-code",
        project_id: cached.project_id,
      });
      sessionId = session.session_id;
    }

    await client.sessionEnd({
      session_id: sessionId,
      summary,
      decisions_made: decisionsMade,
      questions_asked: questionsAsked,
      tasks_progressed: tasksProgressed,
      files_changed: filesChanged,
      observations_logged: observationsLogged,
    });

    // Clear session_id from cache
    setDirCacheEntry(cwd, { ...cached, session_id: undefined });
  } catch (error) {
    console.error(`Brain: Failed to end session: ${error instanceof Error ? error.message : error}`);
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatContextPacket(packet: unknown): string {
  const p = packet as Record<string, unknown>;
  const lines: string[] = [];

  lines.push("# Brain Knowledge Graph Context\n");

  // Workspace & project
  const ws = p.workspace as { id: string; name: string } | undefined;
  const proj = p.project as { id: string; name: string; status: string; description?: string } | undefined;
  if (ws) lines.push(`Workspace: ${ws.name}`);
  if (proj) {
    lines.push(`Project: ${proj.name} (${proj.status})`);
    if (proj.description) lines.push(`Description: ${proj.description}`);
  }
  lines.push("");

  // Task scope
  const taskScope = p.task_scope as Record<string, unknown> | undefined;
  if (taskScope) {
    const task = taskScope.task as { id: string; title: string; status: string; description?: string };
    lines.push(`## Current Task: ${task.title} [${task.status}]`);
    if (task.description) lines.push(task.description);

    const subtasks = taskScope.subtasks as Array<{ id: string; title: string; status: string }>;
    if (subtasks?.length) {
      lines.push("\nSubtasks:");
      for (const s of subtasks) lines.push(`  - [${s.status}] ${s.title}`);
    }

    const siblings = taskScope.sibling_tasks as Array<{ id: string; title: string; status: string }>;
    if (siblings?.length) {
      lines.push("\nSibling tasks:");
      for (const s of siblings) lines.push(`  - [${s.status}] ${s.title}`);
    }
    lines.push("");
  }

  // Decisions
  const decisions = p.decisions as { confirmed: unknown[]; provisional: unknown[]; contested: unknown[] } | undefined;
  if (decisions) {
    if (decisions.contested.length > 0) {
      lines.push("## CONTESTED DECISIONS (conflicts — do not proceed without human input)");
      for (const d of decisions.contested as Array<{ summary: string; rationale?: string }>) {
        lines.push(`  - ${d.summary}${d.rationale ? ` — ${d.rationale}` : ""}`);
      }
      lines.push("");
    }

    if (decisions.confirmed.length > 0) {
      lines.push("## Confirmed Decisions (follow these)");
      for (const d of decisions.confirmed as Array<{ summary: string }>) {
        lines.push(`  - ${d.summary}`);
      }
      lines.push("");
    }

    if (decisions.provisional.length > 0) {
      lines.push("## Provisional Decisions (follow but flag for review)");
      for (const d of decisions.provisional as Array<{ summary: string }>) {
        lines.push(`  - ${d.summary}`);
      }
      lines.push("");
    }
  }

  // Active tasks
  const tasks = p.active_tasks as Array<{ title: string; status: string; priority?: string }> | undefined;
  if (tasks?.length) {
    lines.push("## Active Tasks");
    for (const t of tasks) {
      lines.push(`  - [${t.status}]${t.priority ? ` (${t.priority})` : ""} ${t.title}`);
    }
    lines.push("");
  }

  // Open questions
  const questions = p.open_questions as Array<{ text: string; status: string }> | undefined;
  if (questions?.length) {
    lines.push("## Open Questions");
    for (const q of questions) {
      lines.push(`  - [${q.status}] ${q.text}`);
    }
    lines.push("");
  }

  // Recent changes
  const changes = p.recent_changes as Array<{ entity_type: string; entity_name: string; change_type: string; changed_at: string }> | undefined;
  if (changes?.length) {
    lines.push("## Recent Changes");
    for (const c of changes) {
      lines.push(`  - [${c.entity_type}] ${c.entity_name} — ${c.change_type}`);
    }
    lines.push("");
  }

  // Observations
  const observations = p.observations as Array<{ text: string; severity: string }> | undefined;
  if (observations?.length) {
    lines.push("## Observations");
    for (const o of observations) {
      lines.push(`  - [${o.severity}] ${o.text}`);
    }
    lines.push("");
  }

  // Active agent sessions (cross-agent awareness)
  type ActiveSession = {
    agent: string;
    started_at: string;
    task?: { id: string; title: string };
    provisional_decisions: Array<{ summary: string }>;
    observations: Array<{ text: string; severity: string }>;
  };
  const activeSessions = p.active_sessions as ActiveSession[] | undefined;
  if (activeSessions?.length) {
    lines.push("## Active Agent Sessions");
    for (const s of activeSessions) {
      const ago = formatTimeAgo(s.started_at);
      lines.push(`  - ${s.agent} (started ${ago})`);
      if (s.task) {
        lines.push(`    Working on: ${s.task.title}`);
      }
      if (s.provisional_decisions.length > 0) {
        lines.push("    Provisional decisions:");
        for (const d of s.provisional_decisions) {
          lines.push(`      - ${d.summary}`);
        }
      }
      if (s.observations.length > 0) {
        lines.push("    Observations:");
        for (const o of s.observations) {
          lines.push(`      - [${o.severity}] ${o.text}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
