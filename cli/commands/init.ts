import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { findGitRoot, saveRepoConfig, loadGlobalConfig } from "../config";
import { BrainHttpClient } from "../http-client";
import {
  BRAIN_HOOKS,
  BRAIN_CLAUDE_MD,
  BRAIN_COMMANDS,
} from "./init-content";

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
// Step 1: Auth (OAuth 2.1 PKCE)
// ---------------------------------------------------------------------------

const DEFAULT_SCOPES = "graph:read graph:reason decision:write task:write observation:write question:write session:write offline_access";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function setupAuth(
  serverUrl: string,
  workspaceId: string,
  gitRoot: string,
  options?: { openUrl?: (url: string) => void },
): Promise<void> {
  const global = await loadGlobalConfig();
  const existing = global?.repos[gitRoot];
  if (existing && existing.workspace === workspaceId && existing.access_token) {
    console.log(`✓ Auth: already configured for ${gitRoot}`);
    return;
  }

  // 1. Verify workspace exists
  try {
    await BrainHttpClient.listProjects(serverUrl, workspaceId);
  } catch {
    console.error(`Workspace ${workspaceId} not found on ${serverUrl}`);
    process.exit(1);
  }

  // 2. Dynamic Client Registration
  const dcrRes = await fetch(`${serverUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: `brain-cli-${workspaceId.slice(0, 8)}`,
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!dcrRes.ok) {
    throw new Error(`Client registration failed: ${dcrRes.status} ${await dcrRes.text()}`);
  }
  const { client_id } = await dcrRes.json() as { client_id: string };

  // 3. PKCE
  const pkce = generatePkce();
  const state = base64url(randomBytes(16));

  // 4. Start local callback server
  const { promise: codePromise, resolve: resolveCode, reject: rejectCode } = Promise.withResolvers<string>();

  const callbackServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/callback": (request) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          rejectCode(new Error(`OAuth error: ${error}`));
          return new Response("<html><body><h1>Authentication failed</h1><p>You can close this tab.</p></body></html>", {
            headers: { "Content-Type": "text/html" },
          });
        }
        if (returnedState !== state) {
          rejectCode(new Error("state mismatch"));
          return new Response("<html><body><h1>State mismatch</h1></body></html>", {
            headers: { "Content-Type": "text/html" },
          });
        }
        if (!code) {
          rejectCode(new Error("no code returned"));
          return new Response("<html><body><h1>No authorization code</h1></body></html>", {
            headers: { "Content-Type": "text/html" },
          });
        }

        resolveCode(code);
        return new Response("<html><body><h1>Authenticated!</h1><p>You can close this tab and return to the terminal.</p></body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
  });

  const redirectUri = `http://127.0.0.1:${callbackServer.port}/callback`;

  // Update redirect_uris with actual port (re-register)
  const dcrUpdateRes = await fetch(`${serverUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: `brain-cli-${workspaceId.slice(0, 8)}`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!dcrUpdateRes.ok) {
    callbackServer.stop();
    throw new Error(`Client re-registration failed: ${dcrUpdateRes.status} ${await dcrUpdateRes.text()}`);
  }
  const dcrUpdate = await dcrUpdateRes.json() as { client_id: string };
  const actualClientId = dcrUpdate.client_id;

  // 5. Open browser
  const authUrl = new URL(`${serverUrl}/api/auth/oauth2/authorize`);
  authUrl.searchParams.set("client_id", actualClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", DEFAULT_SCOPES);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  // Pass resource so better-auth issues a JWT access token (not opaque)
  authUrl.searchParams.set("resource", `${serverUrl}/api/auth`);

  console.log("Opening browser for authentication...");
  console.log(`If the browser doesn't open, visit: ${authUrl.toString()}\n`);

  const openUrl = options?.openUrl ?? ((url: string) => {
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([openCmd, url], { stdout: "ignore", stderr: "ignore" });
  });
  openUrl(authUrl.toString());

  // 6. Wait for callback
  let code: string;
  try {
    code = await codePromise;
  } catch (error) {
    callbackServer.stop();
    throw error;
  }

  // 7. Exchange code for tokens
  const tokenRes = await fetch(`${serverUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: actualClientId,
      code_verifier: pkce.verifier,
      resource: serverUrl,
    }),
  });

  callbackServer.stop();

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  // 8. Store tokens
  await saveRepoConfig(serverUrl, gitRoot, {
    workspace: workspaceId,
    client_id: actualClientId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
  });

  console.log(`✓ Auth: OAuth tokens saved for ${gitRoot}`);
}

// ---------------------------------------------------------------------------
// Step 2: .mcp.json
// ---------------------------------------------------------------------------

export async function setupMcpJson(gitRoot: string): Promise<void> {
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

export async function setupClaudeHooks(gitRoot: string): Promise<void> {
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

export const MARKER_START = "<!-- brain-plugin-start -->";
export const MARKER_END = "<!-- brain-plugin-end -->";

export async function setupClaudeMd(gitRoot: string): Promise<void> {
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
  const postCommitScript = `#!/bin/sh
# Brain post-commit hook: fire-and-forget commit-check
brain commit-check &
exit 0
`;

  if (!existsSync(preCommitPath)) {
    writeFileSync(preCommitPath, preCommitScript, { mode: 0o755 });
    console.log("✓ Git: pre-commit hook installed");
  } else {
    console.log("✓ Git: pre-commit hook already exists");
  }

  // Remove legacy Brain post-commit hook, then install new one
  if (existsSync(postCommitPath)) {
    const postCommitContent = readFileSync(postCommitPath, "utf-8");
    const isLegacyBrain =
      postCommitContent.includes("Brain post-commit hook") &&
      postCommitContent.includes("brain log-commit");
    const isCurrentBrain =
      postCommitContent.includes("Brain post-commit hook") &&
      postCommitContent.includes("brain commit-check");
    if (isLegacyBrain) {
      unlinkSync(postCommitPath);
      console.log("  Removed legacy Brain post-commit hook");
    } else if (isCurrentBrain) {
      console.log("✓ Git: post-commit hook already exists");
      return;
    } else {
      // Non-brain hook — leave it alone
      console.log("✓ Git: post-commit hook already exists (non-brain)");
      return;
    }
  }

  writeFileSync(postCommitPath, postCommitScript, { mode: 0o755 });
  console.log("✓ Git: post-commit hook installed");
}

export async function setupCommands(gitRoot: string): Promise<void> {
  const commandsDir = join(gitRoot, ".claude", "commands");
  if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });

  let count = 0;
  for (const [filename, content] of Object.entries(BRAIN_COMMANDS)) {
    await Bun.write(join(commandsDir, filename), content + "\n");
    count++;
  }

  console.log(`✓ Commands: ${count} slash commands installed to .claude/commands/`);
}

