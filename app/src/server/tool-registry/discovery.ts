/**
 * MCP Tool Discovery Service
 *
 * Pure functions for diffing remote MCP server tools against local records,
 * inferring risk levels from MCP annotations, and filtering by selection.
 *
 * Effectful wrappers handle MCP client connections and DB persistence.
 *
 * Pure core (unit-testable):
 *   - inferRiskLevel(annotations) -> ToolRiskLevel
 *   - computeSyncActions(remoteTools, existingTools) -> ToolSyncDetail[]
 *   - filterBySelection(tools, selectedTools?) -> ToolSyncDetail[]
 *
 * Effectful boundary (acceptance-testable):
 *   - discoverTools(deps, server, options) -> DiscoveryResult
 *   - applySyncActions(deps, server, syncDetails) -> SyncApplyResult
 */
import { RecordId, type Surreal } from "surrealdb";
import type { McpClientFactory, ToolListResult } from "./mcp-client";
import type {
  ToolRiskLevel,
  ToolSyncAction,
  ToolSyncDetail,
  McpServerRecord,
  McpTransport,
} from "./types";
import { resolveAuthForMcpServer } from "../proxy/credential-resolver";

// ---------------------------------------------------------------------------
// Public types for pure functions
// ---------------------------------------------------------------------------

/**
 * A tool as reported by the remote MCP server (from client.listTools()).
 */
export type RemoteTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

/**
 * Minimal shape of an existing local mcp_tool record needed for diffing.
 */
export type ExistingToolRecord = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  risk_level: string;
  status: string;
};

/**
 * Result of applying sync actions to the database.
 */
export type SyncApplyResult = {
  created: number;
  updated: number;
  disabled: number;
  unchanged: number;
  tools: ToolSyncDetail[];
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Infer risk level from MCP tool annotations.
 *
 * Priority:
 *   1. destructiveHint === true  -> "high"
 *   2. readOnlyHint === true     -> "low"
 *   3. idempotentHint === true   -> "low"
 *   4. default                   -> "medium"
 */
export function inferRiskLevel(
  annotations: Record<string, unknown> | undefined,
): ToolRiskLevel {
  if (!annotations) return "medium";

  if (annotations.destructiveHint === true) return "high";
  if (annotations.readOnlyHint === true) return "low";
  if (annotations.idempotentHint === true) return "low";

  return "medium";
}

/**
 * Compute sync actions by diffing remote tools against existing local records.
 *
 * For each remote tool:
 *   - Not in local           -> action: "create"
 *   - In local, schema/desc differs -> action: "update"
 *   - In local, identical    -> action: "unchanged"
 *
 * For each local tool NOT in remote (and still active):
 *   -> action: "disable"
 */
export function computeSyncActions(
  remoteTools: RemoteTool[],
  existingTools: ExistingToolRecord[],
): ToolSyncDetail[] {
  const existingByName = new Map(
    existingTools.map((tool) => [tool.name, tool]),
  );
  const remoteNames = new Set(remoteTools.map((tool) => tool.name));
  const result: ToolSyncDetail[] = [];

  // Process remote tools
  for (const remote of remoteTools) {
    const existing = existingByName.get(remote.name);
    const riskLevel = inferRiskLevel(remote.annotations);

    if (!existing) {
      result.push({
        name: remote.name,
        description: remote.description,
        input_schema: remote.inputSchema,
        output_schema: remote.outputSchema,
        action: "create",
        risk_level: riskLevel,
      });
      continue;
    }

    const descriptionChanged = remote.description !== existing.description;
    const inputSchemaChanged =
      JSON.stringify(remote.inputSchema) !==
      JSON.stringify(existing.input_schema);
    const outputSchemaChanged =
      JSON.stringify(remote.outputSchema) !==
      JSON.stringify(existing.output_schema);

    const action: ToolSyncAction =
      descriptionChanged || inputSchemaChanged || outputSchemaChanged
        ? "update"
        : "unchanged";

    result.push({
      name: remote.name,
      description: remote.description,
      input_schema: remote.inputSchema,
      output_schema: remote.outputSchema,
      action,
      risk_level: riskLevel,
    });
  }

  // Process local-only tools (candidates for disable)
  for (const existing of existingTools) {
    if (!remoteNames.has(existing.name) && existing.status !== "disabled") {
      result.push({
        name: existing.name,
        description: existing.description,
        input_schema: existing.input_schema,
        output_schema: existing.output_schema,
        action: "disable",
        risk_level: existing.risk_level as ToolRiskLevel,
      });
    }
  }

  return result;
}

/**
 * Filter sync details to only include tools in the selection list.
 * If no selection provided (undefined or empty array), returns all tools.
 */
export function filterBySelection(
  tools: ToolSyncDetail[],
  selectedTools: string[] | undefined,
): ToolSyncDetail[] {
  if (!selectedTools || selectedTools.length === 0) return tools;

  const selectedSet = new Set(selectedTools);
  return tools.filter((tool) => selectedSet.has(tool.name));
}

// ---------------------------------------------------------------------------
// Effectful functions (DB + MCP client)
// ---------------------------------------------------------------------------

/** Dependencies for the discovery service. */
export type DiscoveryDeps = {
  surreal: Surreal;
  mcpClientFactory: McpClientFactory;
  toolEncryptionKey?: string;
};

/** Options for the discoverTools function. */
export type DiscoverToolsOptions = {
  dryRun: boolean;
  selectedTools?: string[];
};

/**
 * Convert MCP SDK tool list result to our RemoteTool shape.
 */
export function toRemoteTools(toolListResult: ToolListResult): RemoteTool[] {
  return toolListResult.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
    outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
    annotations: tool.annotations as Record<string, unknown> | undefined,
  }));
}

/**
 * Fetch existing mcp_tool records for a server from SurrealDB.
 */
export async function fetchExistingToolsForServer(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
): Promise<ExistingToolRecord[]> {
  const results = await surreal.query<[ExistingToolRecord[]]>(
    `SELECT name, description, input_schema, output_schema, risk_level, status
     FROM mcp_tool
     WHERE source_server = $server;`,
    { server: serverRecord },
  );
  return results[0] ?? [];
}

/**
 * Run full discovery: connect to MCP server, list tools, diff against
 * existing records, optionally apply changes.
 *
 * Returns a DiscoveryResult with per-tool sync details + summary counts.
 */
export async function discoverTools(
  deps: DiscoveryDeps,
  server: McpServerRecord,
  options: DiscoverToolsOptions,
): Promise<SyncApplyResult> {
  const serverRecord = server.id;

  // 1. Resolve auth headers for the server, then connect
  const authHeaders = deps.toolEncryptionKey
    ? await resolveAuthForMcpServer(server, deps.toolEncryptionKey, {
        surreal: deps.surreal,
        toolEncryptionKey: deps.toolEncryptionKey,
      })
    : {};

  const connection = await deps.mcpClientFactory.connect(
    server.url,
    server.transport as McpTransport,
    Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
  );

  let toolListResult: ToolListResult;
  try {
    toolListResult = await deps.mcpClientFactory.fetchToolList(
      connection.client,
    );
  } finally {
    await deps.mcpClientFactory.disconnect(connection.client).catch(() => {});
  }

  // 2. Convert to RemoteTool shape
  const remoteTools = toRemoteTools(toolListResult);

  // 3. Fetch existing local tools for this server
  const existingTools = await fetchExistingToolsForServer(
    deps.surreal,
    serverRecord,
  );

  // 4. Compute sync actions
  let syncDetails = computeSyncActions(remoteTools, existingTools);

  // 5. Apply selection filter
  syncDetails = filterBySelection(syncDetails, options.selectedTools);

  // 6. Count actions
  const counts = countActions(syncDetails);

  // 7. If not dry-run, apply changes to DB
  if (!options.dryRun) {
    await applySyncActions(deps.surreal, server, syncDetails);
  }

  return {
    ...counts,
    tools: syncDetails,
  };
}

/**
 * Count actions in a list of sync details.
 */
function countActions(tools: ToolSyncDetail[]): {
  created: number;
  updated: number;
  disabled: number;
  unchanged: number;
} {
  let created = 0;
  let updated = 0;
  let disabled = 0;
  let unchanged = 0;

  for (const tool of tools) {
    switch (tool.action) {
      case "create":
        created++;
        break;
      case "update":
        updated++;
        break;
      case "disable":
        disabled++;
        break;
      case "unchanged":
        unchanged++;
        break;
    }
  }

  return { created, updated, disabled, unchanged };
}

/**
 * Apply sync actions to SurrealDB: create/update/disable tools,
 * update server metadata.
 */
async function applySyncActions(
  surreal: Surreal,
  server: McpServerRecord,
  syncDetails: ToolSyncDetail[],
): Promise<void> {
  const serverRecord = server.id;
  const workspaceRecord = server.workspace;

  for (const tool of syncDetails) {
    switch (tool.action) {
      case "create": {
        const toolId = `tool-${crypto.randomUUID()}`;
        const toolRecord = new RecordId("mcp_tool", toolId);
        await surreal.query(`CREATE $tool CONTENT $content;`, {
          tool: toolRecord,
          content: {
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
            output_schema: tool.output_schema,
            risk_level: tool.risk_level,
            toolkit: server.name,
            status: "active",
            workspace: workspaceRecord,
            source_server: serverRecord,
            created_at: new Date(),
          },
        });
        break;
      }
      case "update": {
        await surreal.query(
          `UPDATE mcp_tool SET
             description = $description,
             input_schema = $inputSchema,
             output_schema = $outputSchema,
             risk_level = $riskLevel,
             toolkit = $toolkit
           WHERE name = $name AND source_server = $server;`,
          {
            description: tool.description,
            inputSchema: tool.input_schema,
            outputSchema: tool.output_schema,
            riskLevel: tool.risk_level,
            toolkit: server.name,
            name: tool.name,
            server: serverRecord,
          },
        );
        break;
      }
      case "disable": {
        await surreal.query(
          `UPDATE mcp_tool SET status = "disabled"
           WHERE name = $name AND source_server = $server;`,
          { name: tool.name, server: serverRecord },
        );
        break;
      }
      // "unchanged" -> no DB write needed
    }
  }

  // Update server metadata
  const activeToolCount = syncDetails.filter(
    (t) => t.action !== "disable",
  ).length;

  await surreal.query(
    `UPDATE $server SET
       last_discovery = time::now(),
       tool_count = $toolCount;`,
    { server: serverRecord, toolCount: activeToolCount },
  );
}

