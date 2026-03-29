#!/usr/bin/env bun

import { runInit } from "./commands/init";
import { runCheckUpdates, runEndSession } from "./commands/system";
import { runCheckCommit, runLogCommit } from "./commands/git-hooks";
import { runCommitCheck } from "./commands/commit-check";

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

async function main(): Promise<void> {
  switch (command) {
    case "init":
      await runInit();
      break;

    case "system":
      switch (subcommand) {
        case "check-updates":
          await runCheckUpdates();
          break;
        case "end-session":
          await runEndSession();
          break;
        default:
          console.error(`Unknown system subcommand: ${subcommand}`);
          console.error("Available: check-updates, end-session");
          process.exit(1);
      }
      break;

    case "check-commit":
      await runCheckCommit();
      break;

    case "log-commit":
      await runLogCommit();
      break;

    case "commit-check":
      await runCommitCheck();
      break;

    case "mcp":
      // MCP stdio server — import dynamically to avoid loading deps unless needed
      const { runMcpServer } = await import("./mcp-server");
      await runMcpServer();
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
      }
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

function printHelp(): void {
  console.log(`
osabio — Connect coding agents to the Osabio knowledge graph

Usage:
  osabio init                     Set up Osabio integration (auth, MCP, hooks, commands, git hooks)
  osabio system check-updates     Check for graph updates (UserPromptSubmit hook)
  osabio system end-session       End agent session (SessionEnd hook)
  osabio check-commit             Pre-commit hook: check for task completion
  osabio commit-check             Post-commit hook: extract task refs and mark done
  osabio log-commit               Deprecated no-op (GitHub webhook ingests commits)
  osabio mcp                      Start MCP stdio server

Environment:
  OSABIO_SERVER_URL      Osabio server URL (default: http://localhost:3000)
  OSABIO_WORKSPACE_ID    Workspace ID (required for init)
  OSABIO_IDENTITY_ID     Identity ID override for env-only MCP auth
  OSABIO_CLIENT_ID       OAuth client ID override (optional in env-only mode)
  OSABIO_ACCESS_TOKEN    Access token override (optional in env-only mode)
  OSABIO_REFRESH_TOKEN   Refresh token override (optional in env-only mode)
  OSABIO_TOKEN_EXPIRES_AT Unix timestamp override (optional)
  OSABIO_DPOP_PRIVATE_JWK JSON string override (optional)
  OSABIO_DPOP_PUBLIC_JWK JSON string override (optional)
  OSABIO_DPOP_THUMBPRINT DPoP thumbprint override (optional)
  OSABIO_DPOP_ACCESS_TOKEN DPoP access token override (optional)
  OSABIO_DPOP_TOKEN_EXPIRES_AT DPoP token expiry unix timestamp override (optional)

Config:
  ~/.osabio/config.json  Per-repo workspace credentials
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
