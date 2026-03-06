import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

function getBrainDir() { return process.env.BRAIN_CONFIG_DIR ?? join(homedir(), ".brain"); }
function getConfigPath() { return join(getBrainDir(), "config.json"); }

/** Resolved config for a single repo — shape consumed by BrainHttpClient and all commands. */
export type BrainConfig = {
  server_url: string;
  workspace: string;
  client_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
};

/** Per-repo auth entry in ~/.brain/config.json */
export type RepoConfig = {
  workspace: string;
  client_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
};

/** Root shape of ~/.brain/config.json */
export type BrainGlobalConfig = {
  server_url: string;
  repos: Record<string, RepoConfig>;
};

// ---------------------------------------------------------------------------
// Git root
// ---------------------------------------------------------------------------

/**
 * Find the main repository root from any path, including worktrees.
 *
 * In a regular repo, `.git` is a directory → that dir is the root.
 * In a worktree, `.git` is a file containing `gitdir: /path/to/main/.git/worktrees/<name>`.
 * We follow the pointer back to the main repo so all worktrees share one config key.
 */
export function findGitRoot(from: string): string | undefined {
  let dir = from;
  while (dir !== "/") {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      if (statSync(gitPath).isFile()) {
        return resolveWorktreeMainRoot(gitPath) ?? dir;
      }
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

/** Read a worktree .git file and resolve to the main repo root. */
function resolveWorktreeMainRoot(gitFile: string): string | undefined {
  try {
    const content = Bun.file(gitFile).textSync().trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return undefined;

    const gitdir = resolve(dirname(gitFile), match[1]);
    const dotGit = gitdir.replace(/\/worktrees\/[^/]+$/, "");
    return dirname(dotGit);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Global config (~/.brain/config.json)
// ---------------------------------------------------------------------------

function ensureBrainDir(): void {
  const dir = getBrainDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function loadGlobalConfig(): Promise<BrainGlobalConfig | undefined> {
  const file = Bun.file(getConfigPath());
  if (!(await file.exists())) return undefined;
  try {
    return await file.json() as BrainGlobalConfig;
  } catch {
    return undefined;
  }
}

export async function saveGlobalConfig(config: BrainGlobalConfig): Promise<void> {
  ensureBrainDir();
  await Bun.write(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

/** Upsert a repo entry in the global config. Creates the file if needed. */
export async function saveRepoConfig(serverUrl: string, gitRoot: string, repo: RepoConfig): Promise<void> {
  const global = (await loadGlobalConfig()) ?? { server_url: serverUrl, repos: {} };
  global.server_url = serverUrl;
  global.repos[gitRoot] = repo;
  await saveGlobalConfig(global);
}

// ---------------------------------------------------------------------------
// Resolved config (what consumers use)
// ---------------------------------------------------------------------------

/** Resolve BrainConfig for the current repo from ~/.brain/config.json.
 *  The server URL can be overridden via the BRAIN_SERVER_URL env var. */
export async function loadConfig(): Promise<BrainConfig | undefined> {
  const gitRoot = findGitRoot(process.cwd());
  const global = await loadGlobalConfig();
  if (global && gitRoot && global.repos[gitRoot]) {
    const repo = global.repos[gitRoot];
    const serverUrl = process.env.BRAIN_SERVER_URL ?? global.server_url;
    return {
      server_url: serverUrl,
      workspace: repo.workspace,
      client_id: repo.client_id,
      access_token: repo.access_token,
      refresh_token: repo.refresh_token,
      token_expires_at: repo.token_expires_at,
    };
  }
  return undefined;
}

export async function requireConfig(): Promise<BrainConfig> {
  const config = await loadConfig();
  if (!config) {
    console.error("Brain not configured. Run: brain init");
    process.exit(1);
  }
  return config;
}

