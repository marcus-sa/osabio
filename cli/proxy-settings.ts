/**
 * Pure functions for proxy settings management.
 *
 * No IO — these transform data in, data out.
 * IO operations (file reads/writes, HTTP calls) belong in the init command.
 */

/** Shape of .claude/settings.local.json with proxy env vars */
export type ClaudeSettingsLocal = {
  env: Record<string, string>;
  [key: string]: unknown;
};

/**
 * Merge Brain proxy env vars into an existing settings object.
 * Returns a new object — does not mutate the input.
 *
 * Pure function: (existing, serverUrl, proxyToken) => merged settings
 */
export function mergeProxyEnvSettings(
  existing: Record<string, unknown>,
  serverUrl: string,
  proxyToken: string,
): ClaudeSettingsLocal {
  const existingEnv = (existing.env ?? {}) as Record<string, string>;

  const env: Record<string, string> = {
    ...existingEnv,
    ANTHROPIC_BASE_URL: `${serverUrl}/proxy/llm/anthropic`,
    ANTHROPIC_HEADERS: `X-Brain-Auth: ${proxyToken}`,
  };

  return {
    ...existing,
    env,
  } as ClaudeSettingsLocal;
}

/**
 * Check whether settings.local.json is covered by a .gitignore file.
 * Takes the raw gitignore content (or undefined if file doesn't exist).
 *
 * Pure function: (gitignoreContent) => boolean
 */
export function checkSettingsGitignored(
  gitignoreContent: string | undefined,
): boolean {
  if (!gitignoreContent) return false;

  const patterns = gitignoreContent.split("\n");
  return patterns.some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    return (
      trimmed === ".claude/settings.local.json" ||
      trimmed === "/.claude/settings.local.json" ||
      trimmed === "settings.local.json"
    );
  });
}
