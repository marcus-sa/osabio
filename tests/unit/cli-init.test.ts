import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  setupAuth,
  setupMcpJson,
  setupClaudeHooks,
  setupClaudeMd,
  setupCommands,
  installGitHooks,
  MARKER_START,
  MARKER_END,
} from "../../cli/commands/init";
import { loadGlobalConfig } from "../../cli/config";
import { BRAIN_HOOKS, BRAIN_CLAUDE_MD, BRAIN_COMMANDS } from "../../cli/commands/init-content";

let gitRoot: string;

beforeEach(() => {
  gitRoot = mkdtempSync(join(tmpdir(), "brain-init-test-"));
  execSync("git init", { cwd: gitRoot, stdio: "ignore" });
});

afterEach(() => {
  rmSync(gitRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// setupMcpJson
// ---------------------------------------------------------------------------

describe("setupMcpJson", () => {
  it("creates .mcp.json with brain server entry", async () => {
    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.brain).toEqual({ command: "brain", args: ["mcp"] });
  });

  it("preserves existing MCP servers", async () => {
    writeFileSync(
      join(gitRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other-tool" } } }),
    );

    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.other).toEqual({ command: "other-tool" });
    expect(mcp.mcpServers.brain).toEqual({ command: "brain", args: ["mcp"] });
  });

  it("is idempotent on second run", async () => {
    await setupMcpJson(gitRoot);
    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["brain"]);
  });

  it("recovers from corrupted file", async () => {
    writeFileSync(join(gitRoot, ".mcp.json"), "not-json{{{");

    await setupMcpJson(gitRoot);

    const mcp = JSON.parse(readFileSync(join(gitRoot, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.brain).toEqual({ command: "brain", args: ["mcp"] });
  });
});

// ---------------------------------------------------------------------------
// setupClaudeHooks
// ---------------------------------------------------------------------------

describe("setupClaudeHooks", () => {
  const expectedEvents = ["UserPromptSubmit", "Stop", "SessionEnd"];

  it("creates settings.json with all hook events", async () => {
    await setupClaudeHooks(gitRoot);

    const settings = JSON.parse(readFileSync(join(gitRoot, ".claude", "settings.json"), "utf-8"));
    for (const event of expectedEvents) {
      expect(settings.hooks[event]).toBeDefined();
      expect(settings.hooks[event].length).toBeGreaterThan(0);
    }
  });

  it("preserves existing non-brain hooks", async () => {
    mkdirSync(join(gitRoot, ".claude"), { recursive: true });
    writeFileSync(
      join(gitRoot, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "eslint" }] }] },
        otherSetting: true,
      }),
    );

    await setupClaudeHooks(gitRoot);

    const settings = JSON.parse(readFileSync(join(gitRoot, ".claude", "settings.json"), "utf-8"));
    expect(settings.otherSetting).toBe(true);
    // eslint hook preserved + brain hook added
    expect(settings.hooks.UserPromptSubmit.length).toBe(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe("eslint");
  });

  it("does not duplicate brain hooks on second run", async () => {
    await setupClaudeHooks(gitRoot);
    await setupClaudeHooks(gitRoot);

    const settings = JSON.parse(readFileSync(join(gitRoot, ".claude", "settings.json"), "utf-8"));
    for (const event of expectedEvents) {
      expect(settings.hooks[event].length).toBe(1);
    }
  });

  it("creates .claude directory if missing", async () => {
    expect(existsSync(join(gitRoot, ".claude"))).toBe(false);

    await setupClaudeHooks(gitRoot);

    expect(existsSync(join(gitRoot, ".claude", "settings.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setupClaudeMd
// ---------------------------------------------------------------------------

describe("setupClaudeMd", () => {
  it("creates CLAUDE.md with marker-wrapped brain block", async () => {
    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    expect(content).toContain(MARKER_START);
    expect(content).toContain(MARKER_END);
    expect(content).toContain(BRAIN_CLAUDE_MD);
  });

  it("appends to existing CLAUDE.md", async () => {
    writeFileSync(join(gitRoot, "CLAUDE.md"), "# My Project\n\nExisting content.");

    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    expect(content).toStartWith("# My Project\n\nExisting content.");
    expect(content).toContain(MARKER_START);
    expect(content).toContain(BRAIN_CLAUDE_MD);
  });

  it("updates in-place between markers on second run", async () => {
    await setupClaudeMd(gitRoot);
    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    // Only one pair of markers
    const startCount = content.split(MARKER_START).length - 1;
    const endCount = content.split(MARKER_END).length - 1;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it("preserves content before and after brain block when updating", async () => {
    const before = "# My Project\n\nBefore content.\n\n";
    const after = "\n\n## After Section\n\nAfter content.";
    writeFileSync(
      join(gitRoot, "CLAUDE.md"),
      `${before}${MARKER_START}\nold stuff\n${MARKER_END}${after}`,
    );

    await setupClaudeMd(gitRoot);

    const content = readFileSync(join(gitRoot, "CLAUDE.md"), "utf-8");
    expect(content).toStartWith(before);
    expect(content).toEndWith(after);
    expect(content).toContain(BRAIN_CLAUDE_MD);
  });
});

// ---------------------------------------------------------------------------
// setupCommands
// ---------------------------------------------------------------------------

describe("setupCommands", () => {
  it("creates all command files", async () => {
    await setupCommands(gitRoot);

    for (const filename of Object.keys(BRAIN_COMMANDS)) {
      expect(existsSync(join(gitRoot, ".claude", "commands", filename))).toBe(true);
    }
  });

  it("writes correct content with trailing newline", async () => {
    await setupCommands(gitRoot);

    for (const [filename, expectedContent] of Object.entries(BRAIN_COMMANDS)) {
      const actual = readFileSync(join(gitRoot, ".claude", "commands", filename), "utf-8");
      expect(actual).toBe(expectedContent + "\n");
    }
  });

  it("creates directory structure if missing", async () => {
    expect(existsSync(join(gitRoot, ".claude", "commands"))).toBe(false);

    await setupCommands(gitRoot);

    expect(existsSync(join(gitRoot, ".claude", "commands"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// installGitHooks
// ---------------------------------------------------------------------------

describe("installGitHooks", () => {
  it("creates pre-commit hook with correct content and permissions", () => {
    installGitHooks(gitRoot);

    const hookPath = join(gitRoot, ".git", "hooks", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("brain check-commit");

    const mode = statSync(hookPath).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("does not overwrite existing pre-commit hook", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "pre-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nmy-custom-hook\n");

    installGitHooks(gitRoot);

    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("my-custom-hook");
    expect(content).not.toContain("brain check-commit");
  });

  it("replaces legacy Brain post-commit hook with commit-check hook", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\n# Brain post-commit hook\nbrain log-commit\n");

    installGitHooks(gitRoot);

    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("brain commit-check");
    expect(content).not.toContain("brain log-commit");
  });

  it("preserves non-Brain post-commit hooks", () => {
    const hookPath = join(gitRoot, ".git", "hooks", "post-commit");
    mkdirSync(join(gitRoot, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nmy-custom-post-commit\n");

    installGitHooks(gitRoot);

    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain("my-custom-post-commit");
  });
});

// ---------------------------------------------------------------------------
// setupAuth
// ---------------------------------------------------------------------------

describe("setupAuth", () => {
  let configDir: string;
  const originalConfigDir = process.env.BRAIN_CONFIG_DIR;
  let originalFetch: typeof fetch;
  let originalServe: typeof Bun.serve;
  let callbackHandler: ((request: Request) => Response) | undefined;
  let callbackServerStopped = false;
  let registerBodies: Array<{ redirect_uris?: string[] }> = [];
  let tokenRequestResource: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalServe = Bun.serve;
    callbackHandler = undefined;
    callbackServerStopped = false;
    registerBodies = [];
    tokenRequestResource = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Bun.serve = originalServe;

    if (originalConfigDir) {
      process.env.BRAIN_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.BRAIN_CONFIG_DIR;
    }

    if (configDir) rmSync(configDir, { recursive: true, force: true });
  });

  it("registers OAuth client once using the real loopback callback URI", async () => {
    configDir = mkdtempSync(join(tmpdir(), "brain-init-config-"));
    process.env.BRAIN_CONFIG_DIR = configDir;

    const workspaceId = crypto.randomUUID();
    const baseUrl = "http://brain.local";

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === `/api/mcp/${workspaceId}/projects`) {
        return Response.json({
          workspace: { id: workspaceId, name: "Test Workspace" },
          projects: [{ id: crypto.randomUUID(), name: "Test Project" }],
        });
      }

      if (url.pathname === "/api/auth/oauth2/register" && request.method === "POST") {
        const body = await request.json() as { redirect_uris?: string[] };
        registerBodies.push(body);
        return Response.json({ client_id: "test-client-id" });
      }

      if (url.pathname === "/api/auth/oauth2/token" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        if (form.get("code") !== "test-code") {
          return new Response("invalid code", { status: 400 });
        }
        tokenRequestResource = form.get("resource") ?? undefined;

        return Response.json({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      if (url.pathname === `/api/auth/identity/${workspaceId}`) {
        return Response.json({ identity_id: "identity:test-owner" });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
      const routes = (options as { routes?: Record<string, (request: Request) => Response> }).routes;
      callbackHandler = routes?.["/callback"];
      return {
        port: 61009,
        stop: () => {
          callbackServerStopped = true;
        },
      } as ReturnType<typeof Bun.serve>;
    }) as typeof Bun.serve;

    await setupAuth(baseUrl, workspaceId, gitRoot, {
      openUrl: (url) => {
        if (!callbackHandler) throw new Error("callback handler not registered");

        const authUrl = new URL(url);
        const redirectUri = authUrl.searchParams.get("redirect_uri");
        const state = authUrl.searchParams.get("state");
        if (!redirectUri || !state) throw new Error("missing redirect uri or state");

        const callbackUrl = new URL(redirectUri);
        callbackUrl.searchParams.set("code", "test-code");
        callbackUrl.searchParams.set("state", state);

        callbackHandler(new Request(callbackUrl.toString()));
      },
    });

    expect(registerBodies).toHaveLength(1);
    expect(registerBodies[0]?.redirect_uris).toHaveLength(1);
    expect(registerBodies[0]?.redirect_uris?.[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(registerBodies[0]?.redirect_uris?.[0]).not.toBe("http://127.0.0.1/callback");
    expect(tokenRequestResource).toBe(`${baseUrl}/api/auth`);
    expect(callbackServerStopped).toBe(true);

    const globalConfig = await loadGlobalConfig();
    expect(globalConfig?.repos[gitRoot]).toBeDefined();
    expect(globalConfig?.repos[gitRoot]?.client_id).toBe("test-client-id");
    expect(globalConfig?.repos[gitRoot]?.access_token).toBe("test-access-token");
  });

  it("fails fast when callback is never received", async () => {
    configDir = mkdtempSync(join(tmpdir(), "brain-init-config-"));
    process.env.BRAIN_CONFIG_DIR = configDir;

    const workspaceId = crypto.randomUUID();
    const baseUrl = "http://brain.local";

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === `/api/mcp/${workspaceId}/projects`) {
        return Response.json({
          workspace: { id: workspaceId, name: "Test Workspace" },
          projects: [{ id: crypto.randomUUID(), name: "Test Project" }],
        });
      }

      if (url.pathname === "/api/auth/oauth2/register" && request.method === "POST") {
        return Response.json({ client_id: "test-client-id" });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
      const routes = (options as { routes?: Record<string, (request: Request) => Response> }).routes;
      callbackHandler = routes?.["/callback"];
      return {
        port: 61010,
        stop: () => {
          callbackServerStopped = true;
        },
      } as ReturnType<typeof Bun.serve>;
    }) as typeof Bun.serve;

    const outcome = await Promise.race([
      setupAuth(baseUrl, workspaceId, gitRoot, {
        openUrl: () => {
          // No callback dispatch: simulates browser/auth flow never returning.
        },
        callbackTimeoutMs: 50,
      }).then(() => "resolved").catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(callbackHandler).toBeDefined();
    expect(outcome).not.toBe("hung");
    expect(outcome).toBeInstanceOf(Error);
    expect(callbackServerStopped).toBe(true);
    if (outcome instanceof Error) {
      expect(outcome.message).toContain("Timed out waiting for OAuth callback");
    }
  });
});
