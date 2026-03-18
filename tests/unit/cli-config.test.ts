import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findGitRoot, loadConfig } from "../../cli/config";

const ENV_KEYS = [
  "BRAIN_CONFIG_DIR",
  "BRAIN_SERVER_URL",
  "BRAIN_WORKSPACE_ID",
  "BRAIN_CLIENT_ID",
  "BRAIN_ACCESS_TOKEN",
  "BRAIN_REFRESH_TOKEN",
  "BRAIN_TOKEN_EXPIRES_AT",
  "BRAIN_DPOP_PRIVATE_JWK",
  "BRAIN_DPOP_PUBLIC_JWK",
  "BRAIN_DPOP_THUMBPRINT",
  "BRAIN_DPOP_ACCESS_TOKEN",
  "BRAIN_DPOP_TOKEN_EXPIRES_AT",
  "BRAIN_IDENTITY_ID",
  "BRAIN_PROXY_TOKEN_EXPIRES_AT",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("cli config env overrides", () => {
  test("loads env-only config without ~/.brain/config.json", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "brain-config-env-only-"));
    process.env.BRAIN_CONFIG_DIR = configDir;
    process.env.BRAIN_SERVER_URL = "http://127.0.0.1:1999";
    process.env.BRAIN_WORKSPACE_ID = "ws-env-only";
    process.env.BRAIN_IDENTITY_ID = "identity-env-only";

    const config = await loadConfig();

    expect(config).toBeDefined();
    expect(config?.server_url).toBe("http://127.0.0.1:1999");
    expect(config?.workspace).toBe("ws-env-only");
    expect(config?.identity_id).toBe("identity-env-only");
    expect(config?.client_id).toBe("brain-env-client");
    expect(config?.access_token).toBe("brain-env-access-token");

    rmSync(configDir, { recursive: true, force: true });
  });

  test("env vars override repo config values", async () => {
    const gitRoot = findGitRoot(process.cwd());
    expect(gitRoot).toBeDefined();
    if (!gitRoot) return;

    const configDir = mkdtempSync(join(tmpdir(), "brain-config-override-"));
    mkdirSync(configDir, { recursive: true });

    const configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({
      server_url: "http://from-file:3000",
      repos: {
        [gitRoot]: {
          workspace: "ws-from-file",
          client_id: "client-from-file",
          access_token: "access-from-file",
          refresh_token: "refresh-from-file",
          token_expires_at: 1111111111,
        },
      },
    }));

    process.env.BRAIN_CONFIG_DIR = configDir;
    process.env.BRAIN_SERVER_URL = "http://from-env:3000";
    process.env.BRAIN_WORKSPACE_ID = "ws-from-env";
    process.env.BRAIN_ACCESS_TOKEN = "access-from-env";
    process.env.BRAIN_REFRESH_TOKEN = "refresh-from-env";
    process.env.BRAIN_TOKEN_EXPIRES_AT = "2222222222";

    const config = await loadConfig();

    expect(config).toBeDefined();
    expect(config?.server_url).toBe("http://from-env:3000");
    expect(config?.workspace).toBe("ws-from-env");
    expect(config?.access_token).toBe("access-from-env");
    expect(config?.refresh_token).toBe("refresh-from-env");
    expect(config?.token_expires_at).toBe(2222222222);

    rmSync(configDir, { recursive: true, force: true });
  });
});
