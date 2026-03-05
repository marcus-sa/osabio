import { requireConfig } from "../config";
import { BrainHttpClient } from "../http-client";

/**
 * brain system load-context
 * Called by SessionStart hook. Lists workspace projects so the agent knows what's available.
 */
export async function runLoadContext(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  try {
    const { workspace, projects } = await client.getProjects();
    console.log(`# Brain Workspace: ${workspace.name}\n`);

    if (projects.length === 0) {
      console.log("No projects found. Create one in the Brain web UI.");
      return;
    }

    console.log("Projects:");
    for (const p of projects) {
      console.log(`  - ${p.name} (id: ${p.id})`);
    }
    console.log("\nUse Brain MCP tools to load project context, search entities, and manage work.");
  } catch (error) {
    console.error(`Failed to load workspace: ${error instanceof Error ? error.message : error}`);
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
