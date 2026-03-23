/**
 * Milestone 7 - Schema: MCP Server Table
 *
 * Verifies the mcp_server table schema exists with correct fields, indexes,
 * and the UNIQUE constraint on (workspace, name). Also verifies the
 * source_server field on mcp_tool.
 *
 * This test operates at the DB level (no HTTP endpoints required).
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  seedMcpServer,
  seedDiscoveredTool,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_mcp_server_schema");

describe("mcp_server table schema", () => {
  it("unique constraint on workspace+name prevents duplicate server names", async () => {
    const { surreal } = getRuntime();
    const workspaceId = `ws-schema-${crypto.randomUUID()}`;

    // Create a workspace record so the foreign key is valid
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `CREATE $ws CONTENT {
        name: "test-ws",
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };`,
      { ws: wsRecord },
    );

    // Given a server "GitHub Tools" exists
    await seedMcpServer(surreal, workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
    });

    // When we try to create another server with the same name in the same workspace
    const duplicateId = `srv-dup-${crypto.randomUUID()}`;
    const dupRecord = new RecordId("mcp_server", duplicateId);

    const result = await surreal.query(
      `CREATE $server CONTENT $content;`,
      {
        server: dupRecord,
        content: {
          name: "GitHub Tools",
          url: "https://mcp.acme.dev/github-2",
          transport: "streamable-http",
          workspace: wsRecord,
          tool_count: 0,
          created_at: new Date(),
        },
      },
    ).catch((err: Error) => ({ error: err.message }));

    // Then the insert fails due to UNIQUE index violation
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("index");
  }, 30_000);

  it("source_server field exists on mcp_tool and accepts mcp_server reference", async () => {
    const { surreal } = getRuntime();
    const workspaceId = `ws-srcsvr-${crypto.randomUUID()}`;

    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query(
      `CREATE $ws CONTENT {
        name: "test-ws",
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };`,
      { ws: wsRecord },
    );

    // Given a server exists
    const { serverId } = await seedMcpServer(surreal, workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
    });

    // When we create a tool with source_server pointing to the server
    const { toolId } = await seedDiscoveredTool(surreal, workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    // Then the tool record has the source_server field
    const toolRecord = new RecordId("mcp_tool", toolId);
    const rows = await surreal.query<[Array<{ source_server: RecordId }>]>(
      `SELECT source_server FROM $tool;`,
      { tool: toolRecord },
    );

    expect(rows[0].length).toBe(1);
    expect(rows[0][0].source_server).toBeDefined();
  }, 30_000);
});
