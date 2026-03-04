import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

const BRAIN_DIR = join(homedir(), ".brain");
const CONFIG_PATH = join(BRAIN_DIR, "config.json");
const DIR_CACHE_PATH = join(BRAIN_DIR, "dir-cache.json");

/** Resolved config for a single repo — shape consumed by BrainHttpClient and all commands. */
export type BrainConfig = {
  server_url: string;
  workspace: string;
  api_key: string;
};

/** Per-repo auth entry in ~/.brain/config.json */
export type RepoConfig = {
  workspace: string;
  api_key: string;
};

/** Root shape of ~/.brain/config.json */
export type BrainGlobalConfig = {
  server_url: string;
  repos: Record<string, RepoConfig>;
};

export type DirCacheEntry = {
  project_id: string;
  project_name: string;
  last_session?: string;
  session_id?: string;
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
  if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true });
}

export async function loadGlobalConfig(): Promise<BrainGlobalConfig | undefined> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) return undefined;
  try {
    return await file.json() as BrainGlobalConfig;
  } catch {
    return undefined;
  }
}

export async function saveGlobalConfig(config: BrainGlobalConfig): Promise<void> {
  ensureBrainDir();
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
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
    return { server_url: serverUrl, workspace: repo.workspace, api_key: repo.api_key };
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

// ---------------------------------------------------------------------------
// Dir cache (runtime state for project mapping + sessions)
// ---------------------------------------------------------------------------

export async function loadDirCache(): Promise<Record<string, DirCacheEntry>> {
  const file = Bun.file(DIR_CACHE_PATH);
  if (!(await file.exists())) return {};
  try {
    return await file.json() as Record<string, DirCacheEntry>;
  } catch {
    return {};
  }
}

export async function saveDirCache(cache: Record<string, DirCacheEntry>): Promise<void> {
  ensureBrainDir();
  await Bun.write(DIR_CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}

export async function getDirCacheEntry(directory: string): Promise<DirCacheEntry | undefined> {
  const cache = await loadDirCache();
  return cache[directory];
}

export async function setDirCacheEntry(directory: string, entry: DirCacheEntry): Promise<void> {
  const cache = await loadDirCache();
  cache[directory] = entry;
  await saveDirCache(cache);
}
