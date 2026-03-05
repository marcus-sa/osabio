import { existsSync, mkdirSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { findGitRoot, saveRepoConfig, loadGlobalConfig } from "../config";
import { BrainHttpClient } from "../http-client";
import { BRAIN_HOOKS, BRAIN_CLAUDE_MD, BRAIN_COMMANDS } from "./init-content";

const DEFAULT_SERVER_URL = "http://localhost:3000";

export async function runInit(): Promise<void> {
  const serverUrl = process.env.BRAIN_SERVER_URL ?? DEFAULT_SERVER_URL;
  const workspaceId = process.env.BRAIN_WORKSPACE_ID;

  const gitRoot = findGitRoot(process.cwd());
  if (!gitRoot) {
    console.error("Not inside a git repository. Run brain init from a project directory.");
    process.exit(1);
  }

  if (!workspaceId) {
    console.error("Set BRAIN_WORKSPACE_ID env var to your workspace ID.");
    console.error("Find it in the Brain web UI or the database.");
    process.exit(1);
  }

  console.log("Brain Init\n──────────\n");

  // Step 1: Auth
  await setupAuth(serverUrl, workspaceId, gitRoot);

  // Step 2: .mcp.json
  await setupMcpJson(gitRoot);

  // Step 3: .claude/settings.json hooks
  await setupClaudeHooks(gitRoot);

  // Step 4: CLAUDE.md
  await setupClaudeMd(gitRoot);

  // Step 5: Commands
  await setupCommands(gitRoot);

  // Step 6: Git hooks
  installGitHooks(gitRoot);

  console.log(`\nDone. Restart Claude Code to activate.`);
}

// ---------------------------------------------------------------------------
// Step 1: Auth
// ---------------------------------------------------------------------------

async function setupAuth(serverUrl: string, workspaceId: string, gitRoot: string): Promise<void> {
  const global = await loadGlobalConfig();
  const existing = global?.repos[gitRoot];
  if (existing && existing.workspace === workspaceId) {
    console.log(`✓ Auth: already configured for ${gitRoot}`);
    return;
  }

  const initResult = await BrainHttpClient.initApiKey(serverUrl, workspaceId);
  await saveRepoConfig(serverUrl, gitRoot, {
    workspace: workspaceId,
    api_key: initResult.api_key,
  });
  console.log(`✓ Auth: API key saved for ${gitRoot} → workspace "${initResult.workspace.name}"`);
}

// ---------------------------------------------------------------------------
// Step 2: .mcp.json
// ---------------------------------------------------------------------------

async function setupMcpJson(gitRoot: string): Promise<void> {
  const mcpPath = join(gitRoot, ".mcp.json");
  const file = Bun.file(mcpPath);
  let mcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

  if (await file.exists()) {
    try {
      mcp = await file.json();
      mcp.mcpServers ??= {};
    } catch {
      // Corrupted file — overwrite
    }
  }

  mcp.mcpServers.brain = { command: "brain", args: ["mcp"] };
  await Bun.write(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
  console.log("✓ MCP: .mcp.json updated");
}

// ---------------------------------------------------------------------------
// Step 3: .claude/settings.json hooks
// ---------------------------------------------------------------------------

type HookEntry = { type: string; command?: string; prompt?: string };
type SettingsHookGroup = { matcher?: string; hooks: HookEntry[] };

async function setupClaudeHooks(gitRoot: string): Promise<void> {
  const claudeDir = join(gitRoot, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");
  const file = Bun.file(settingsPath);
  let settings: Record<string, unknown> = {};

  if (await file.exists()) {
    try {
      settings = await file.json();
    } catch {
      // Corrupted — start fresh
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, SettingsHookGroup[]>;
  let added = 0;

  for (const [event, hookDefs] of Object.entries(BRAIN_HOOKS)) {
    hooks[event] ??= [];

    const hasBrain = hooks[event].some((group) =>
      group.hooks?.some(
        (h) => h.command?.startsWith("brain ") || h.prompt?.includes("Brain MCP"),
      ),
    );

    if (!hasBrain) {
      hooks[event].push({ hooks: hookDefs as HookEntry[] });
      added++;
    }
  }

  settings.hooks = hooks;
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`✓ Hooks: .claude/settings.json updated (${added} hooks added)`);
}

// ---------------------------------------------------------------------------
// Step 4: CLAUDE.md
// ---------------------------------------------------------------------------

const MARKER_START = "<!-- brain-plugin-start -->";
const MARKER_END = "<!-- brain-plugin-end -->";

async function setupClaudeMd(gitRoot: string): Promise<void> {
  const claudeMdPath = join(gitRoot, "CLAUDE.md");
  const file = Bun.file(claudeMdPath);
  let content = "";

  if (await file.exists()) {
    content = await file.text();
  }

  const brainBlock = `${MARKER_START}\n${BRAIN_CLAUDE_MD}\n${MARKER_END}`;

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + brainBlock + content.slice(endIdx + MARKER_END.length);
  } else {
    const separator = content.length > 0 && !content.endsWith("\n\n") ? "\n\n" : "";
    content = content + separator + brainBlock + "\n";
  }

  await Bun.write(claudeMdPath, content);
  console.log("✓ CLAUDE.md: Brain plugin instructions added");
}

// ---------------------------------------------------------------------------
// Step 6: Git hooks
// ---------------------------------------------------------------------------

export function installGitHooks(gitRoot?: string): void {
  const root = gitRoot ?? findGitRoot(process.cwd());
  if (!root) {
    console.log("  No .git directory found — skipping git hook installation.");
    return;
  }

  const hooksDir = join(root, ".git", "hooks");
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

  const preCommitPath = join(hooksDir, "pre-commit");
  const postCommitPath = join(hooksDir, "post-commit");
  const preCommitScript = `#!/bin/sh
# Brain pre-commit hook: check for task completion and unlogged decisions
brain check-commit
`;

  if (!existsSync(preCommitPath)) {
    Bun.writeSync(Bun.openSync(preCommitPath, "w"), preCommitScript);
    chmodSync(preCommitPath, 0o755);
    console.log("✓ Git: pre-commit hook installed");
  } else {
    console.log("✓ Git: pre-commit hook already exists");
  }

  // Remove legacy Brain post-commit hook
  if (existsSync(postCommitPath)) {
    const postCommitContent = Bun.file(postCommitPath).textSync();
    const isBrainManaged =
      postCommitContent.includes("Brain post-commit hook") &&
      postCommitContent.includes("brain log-commit");
    if (isBrainManaged) {
      unlinkSync(postCommitPath);
      console.log("  Removed legacy Brain post-commit hook");
    }
  }
}

async function setupCommands(gitRoot: string): Promise<void> {
  const commandsDir = join(gitRoot, ".claude", "commands");
  if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });

  let count = 0;
  for (const [filename, content] of Object.entries(BRAIN_COMMANDS)) {
    await Bun.write(join(commandsDir, filename), content + "\n");
    count++;
  }

  console.log(`✓ Commands: ${count} slash commands installed to .claude/commands/`);
}

