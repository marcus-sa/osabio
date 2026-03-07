import { spawn, type ChildProcess } from "node:child_process";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { OpencodeConfig } from "./config-builder";
import type { OpenCodeHandle } from "./session-lifecycle";

// ---------------------------------------------------------------------------
// Port allocation — find a free port by binding to 0
// ---------------------------------------------------------------------------

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// SDK Config translation
// ---------------------------------------------------------------------------

type SdkConfig = {
  model?: string;
  mcp?: Record<string, { type: "remote"; url: string; headers?: Record<string, string> }>;
  agent?: {
    build?: {
      permission?: {
        edit?: "allow" | "ask" | "deny";
        bash?: "allow" | "ask" | "deny";
        webfetch?: "allow" | "ask" | "deny";
      };
    };
  };
};

function toSdkConfig(config: OpencodeConfig): SdkConfig {
  const mcp: SdkConfig["mcp"] = {};
  for (const [name, server] of Object.entries(config.mcpServers)) {
    mcp[name] = {
      type: "remote" as const,
      url: server.url,
      headers: server.headers,
    };
  }

  const permissionMap: Record<string, "allow" | "ask" | "deny"> = {};
  for (const perm of config.permissions.autoApprove) {
    permissionMap[perm] = "allow";
  }

  return {
    model: `${config.model.provider}/${config.model.model}`,
    mcp,
    agent: {
      build: {
        permission: {
          edit: permissionMap["edit"] ?? permissionMap["write"] ?? "allow",
          bash: permissionMap["bash"] ?? "allow",
          webfetch: permissionMap["webfetch"] ?? "deny",
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Start OpenCode server process in the worktree directory
// ---------------------------------------------------------------------------

const SERVER_START_TIMEOUT_MS = 15_000;

function startServerProcess(
  port: number,
  hostname: string,
  sdkConfig: SdkConfig,
  worktreePath: string,
  signal: AbortSignal,
): Promise<{ proc: ChildProcess; url: string }> {
  const args = ["serve", `--hostname=${hostname}`, `--port=${port}`];
  const proc = spawn("opencode", args, {
    cwd: worktreePath,
    signal,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(sdkConfig),
    },
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`OpenCode server did not start within ${SERVER_START_TIMEOUT_MS}ms`));
    }, SERVER_START_TIMEOUT_MS);

    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (!match) {
            clearTimeout(timeout);
            proc.kill();
            reject(new Error(`Failed to parse server URL from: ${line}`));
            return;
          }
          clearTimeout(timeout);
          resolve({ proc, url: match[1] });
          return;
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`OpenCode server exited with code ${code}\n${output}`));
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// spawnOpenCode — production implementation
// ---------------------------------------------------------------------------

export async function spawnOpenCode(
  config: OpencodeConfig,
  worktreePath: string,
  taskId: string,
): Promise<OpenCodeHandle> {
  const hostname = "127.0.0.1";
  const port = await findFreePort();
  const sdkConfig = toSdkConfig(config);

  const abortController = new AbortController();

  const { proc, url } = await startServerProcess(
    port,
    hostname,
    sdkConfig,
    worktreePath,
    abortController.signal,
  );

  const client = createOpencodeClient({ baseUrl: url });

  // 1. Create session
  const response = await client.session.create({
    body: { title: `Brain task: ${taskId}` },
  });

  if (response.error) {
    abortController.abort();
    proc.kill();
    throw new Error(`Failed to create OpenCode session: ${JSON.stringify(response.error)}`);
  }

  const sessionId = response.data.id;

  // 2. Subscribe to event stream
  const events = await client.event.subscribe();

  // 3. Send initial command: /brain-start-task <taskId>
  //    Triggers the brain CLI to load task context and validates
  //    CLI installation + authentication. Errors surface via events.
  client.session.command({
    path: { id: sessionId },
    body: { command: "brain-start-task", arguments: taskId },
  }).catch(() => {
    // Errors surface via the event stream as session.error events
  });

  // 4. Build sendPrompt for follow-up messages
  const sendPrompt = async (text: string): Promise<void> => {
    await client.session.promptAsync({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text }] },
    });
  };

  return {
    sessionId,
    sendPrompt,
    eventStream: events.stream,
    abort: () => {
      try {
        client.session.abort({ path: { id: sessionId } }).catch(() => {});
      } finally {
        abortController.abort();
        proc.kill();
      }
    },
  };
}
