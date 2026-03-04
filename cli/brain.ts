#!/usr/bin/env bun

import { runInit } from "./commands/init";
import { runLoadContext, runSetProject, runCheckUpdates, runEndSession } from "./commands/system";
import { runCheckCommit, runLogCommit } from "./commands/git-hooks";

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
        case "load-context":
          await runLoadContext();
          break;
        case "set-project":
          if (!args[2]) {
            console.error("Usage: brain system set-project <project-id>");
            process.exit(1);
          }
          await runSetProject(args[2]);
          break;
        case "check-updates":
          await runCheckUpdates();
          break;
        case "end-session":
          await runEndSession();
          break;
        default:
          console.error(`Unknown system subcommand: ${subcommand}`);
          console.error("Available: load-context, set-project, check-updates, end-session");
          process.exit(1);
      }
      break;

    case "check-commit":
      await runCheckCommit();
      break;

    case "log-commit":
      await runLogCommit();
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
  brain init                     Set up Brain integration (auth, MCP, hooks, skills, git hooks)
  brain system load-context      Load project context (SessionStart hook)
  brain system set-project <id>  Set project for current directory
  brain system check-updates     Check for graph updates (UserPromptSubmit hook)
  brain system end-session       End agent session (SessionEnd hook)
  brain check-commit             Pre-commit hook: check for task completion
  brain log-commit               Deprecated no-op (GitHub webhook ingests commits)
  brain mcp                      Start MCP stdio server

Environment:
  BRAIN_SERVER_URL      Brain server URL (default: http://localhost:3000)
  BRAIN_WORKSPACE_ID    Workspace ID (required for init)

Config:
  ~/.brain/config.json  Per-repo workspace credentials
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
