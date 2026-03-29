import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

function getOsabioDir() { return process.env.OSABIO_CONFIG_DIR ?? join(homedir(), ".osabio"); }
function getConfigPath() { return join(getOsabioDir(), "config.json"); }

/** Resolved config for a single repo — shape consumed by OsabioHttpClient and all commands. */
export type OsabioConfig = {
  server_url: string;
  workspace: string;
  client_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
  /** DPoP key material for sender-constrained tokens */
  dpop_private_jwk?: JsonWebKey;
  dpop_public_jwk?: JsonWebKey;
  dpop_thumbprint?: string;
  /** DPoP-bound access token for MCP endpoints */
  dpop_access_token?: string;
  dpop_token_expires_at?: number;
  /** Identity for intent submission */
  identity_id?: string;
  proxy_token_expires_at?: string;
};

/** Per-repo auth entry in ~/.osabio/config.json */
export type RepoConfig = {
  workspace: string;
  client_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
  dpop_private_jwk?: JsonWebKey;
  dpop_public_jwk?: JsonWebKey;
  dpop_thumbprint?: string;
  dpop_access_token?: string;
  dpop_token_expires_at?: number;
  identity_id?: string;
  proxy_token_expires_at?: string;
};

/** Root shape of ~/.osabio/config.json */
export type OsabioGlobalConfig = {
  server_url: string;
  repos: Record<string, RepoConfig>;
};

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  const normalized = nonEmpty(value);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseJsonWebKey(value: string | undefined): JsonWebKey | undefined {
  const normalized = nonEmpty(value);
  if (!normalized) return undefined;
  try {
    return JSON.parse(normalized) as JsonWebKey;
  } catch {
    return undefined;
  }
}

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
// Global config (~/.osabio/config.json)
// ---------------------------------------------------------------------------

function ensureOsabioDir(): void {
  const dir = getOsabioDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function loadGlobalConfig(): Promise<OsabioGlobalConfig | undefined> {
  const file = Bun.file(getConfigPath());
  if (!(await file.exists())) return undefined;
  try {
    return await file.json() as OsabioGlobalConfig;
  } catch {
    return undefined;
  }
}

export async function saveGlobalConfig(config: OsabioGlobalConfig): Promise<void> {
  ensureOsabioDir();
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

/** Resolve OsabioConfig for the current repo from ~/.osabio/config.json.
 *  The server URL can be overridden via the OSABIO_SERVER_URL env var. */
export async function loadConfig(): Promise<OsabioConfig | undefined> {
  const gitRoot = findGitRoot(process.cwd());
  const global = await loadGlobalConfig();
  const repo = global && gitRoot ? global.repos[gitRoot] : undefined;

  const serverUrl = nonEmpty(process.env.OSABIO_SERVER_URL) ?? global?.server_url;
  const workspaceId = nonEmpty(process.env.OSABIO_WORKSPACE_ID) ?? repo?.workspace;
  if (!serverUrl || !workspaceId) return undefined;

  const defaultTokenExpiresAt = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  return {
    server_url: serverUrl,
    workspace: workspaceId,
    client_id: nonEmpty(process.env.OSABIO_CLIENT_ID) ?? repo?.client_id ?? "osabio-env-client",
    access_token: nonEmpty(process.env.OSABIO_ACCESS_TOKEN) ?? repo?.access_token ?? "osabio-env-access-token",
    refresh_token: nonEmpty(process.env.OSABIO_REFRESH_TOKEN) ?? repo?.refresh_token ?? "osabio-env-refresh-token",
    token_expires_at: parseNumber(process.env.OSABIO_TOKEN_EXPIRES_AT) ?? repo?.token_expires_at ?? defaultTokenExpiresAt,
    dpop_private_jwk: parseJsonWebKey(process.env.OSABIO_DPOP_PRIVATE_JWK) ?? repo?.dpop_private_jwk,
    dpop_public_jwk: parseJsonWebKey(process.env.OSABIO_DPOP_PUBLIC_JWK) ?? repo?.dpop_public_jwk,
    dpop_thumbprint: nonEmpty(process.env.OSABIO_DPOP_THUMBPRINT) ?? repo?.dpop_thumbprint,
    dpop_access_token: nonEmpty(process.env.OSABIO_DPOP_ACCESS_TOKEN) ?? repo?.dpop_access_token,
    dpop_token_expires_at: parseNumber(process.env.OSABIO_DPOP_TOKEN_EXPIRES_AT) ?? repo?.dpop_token_expires_at,
    identity_id: nonEmpty(process.env.OSABIO_IDENTITY_ID) ?? repo?.identity_id,
    proxy_token_expires_at: nonEmpty(process.env.OSABIO_PROXY_TOKEN_EXPIRES_AT) ?? repo?.proxy_token_expires_at,
  };
}

export async function requireConfig(): Promise<OsabioConfig> {
  const config = await loadConfig();
  if (!config) {
    console.error("Osabio not configured. Run: osabio init or set OSABIO_SERVER_URL and OSABIO_WORKSPACE_ID.");
    process.exit(1);
  }
  return config;
}
