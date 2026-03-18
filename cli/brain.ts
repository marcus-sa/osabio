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
brain — Connect coding agents to the Brain knowledge graph

Usage:
  brain init                     Set up Brain integration (auth, MCP, hooks, commands, git hooks)
  brain system check-updates     Check for graph updates (UserPromptSubmit hook)
  brain system end-session       End agent session (SessionEnd hook)
  brain check-commit             Pre-commit hook: check for task completion
  brain commit-check             Post-commit hook: extract task refs and mark done
  brain log-commit               Deprecated no-op (GitHub webhook ingests commits)
  brain mcp                      Start MCP stdio server

Environment:
  BRAIN_SERVER_URL      Brain server URL (default: http://localhost:3000)
  BRAIN_WORKSPACE_ID    Workspace ID (required for init)
  BRAIN_IDENTITY_ID     Identity ID override for env-only MCP auth
  BRAIN_CLIENT_ID       OAuth client ID override (optional in env-only mode)
  BRAIN_ACCESS_TOKEN    Access token override (optional in env-only mode)
  BRAIN_REFRESH_TOKEN   Refresh token override (optional in env-only mode)
  BRAIN_TOKEN_EXPIRES_AT Unix timestamp override (optional)
  BRAIN_DPOP_PRIVATE_JWK JSON string override (optional)
  BRAIN_DPOP_PUBLIC_JWK JSON string override (optional)
  BRAIN_DPOP_THUMBPRINT DPoP thumbprint override (optional)
  BRAIN_DPOP_ACCESS_TOKEN DPoP access token override (optional)
  BRAIN_DPOP_TOKEN_EXPIRES_AT DPoP token expiry unix timestamp override (optional)

Config:
  ~/.brain/config.json  Per-repo workspace credentials
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
