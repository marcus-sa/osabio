#!/usr/bin/env bun

import { runInit } from "./commands/init";
import { runLoadContext, runCheckUpdates, runEndSession, runPreToolUse } from "./commands/system";
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
        case "check-updates":
          await runCheckUpdates();
          break;
        case "end-session":
          await runEndSession();
          break;
        case "pretooluse":
          await runPreToolUse();
          break;
        default:
          console.error(`Unknown system subcommand: ${subcommand}`);
          console.error("Available: load-context, check-updates, end-session, pretooluse");
          process.exit(1);
      }
      break;

    case "check-commit":
      await runCheckCommit();
      break;

    case "log-commit":
      await runLogCommit();
      break;

    case "map": {
      const { runMap } = await import("./commands/map");
      await runMap();
      break;
    }

    case "unmap": {
      const { runUnmap } = await import("./commands/map");
      await runUnmap();
      break;
    }

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
  brain system load-context      Load workspace info (SessionStart hook)
  brain system check-updates     Check for graph updates (UserPromptSubmit hook)
  brain system end-session       End agent session (SessionEnd hook)
  brain system pretooluse        Inject brain context into subagent dispatch (PreToolUse hook)
  brain check-commit             Pre-commit hook: check for task completion
  brain log-commit               Deprecated no-op (GitHub webhook ingests commits)
  brain map <dir> <type:id>      Map directory to a brain entity (project, feature)
  brain unmap <dir>              Remove brain mapping from a directory
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
