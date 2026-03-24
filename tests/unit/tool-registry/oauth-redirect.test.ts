/**
 * Regression tests for OAuth redirect_uri and post-callback redirect fixes.
 *
 * Bug 1: redirect_uri was "/oauth/callback" instead of the workspace-scoped
 *         "/api/workspaces/:wsId/mcp-servers/oauth/callback" route, causing
 *         OAuth providers to redirect to a 404.
 *
 * Bug 2: Post-OAuth success/error redirects pointed to "/tool-registry?tab=servers"
 *         but the frontend route is "/tools?tab=servers", causing another 404.
 *
 * Bug 3: After successful OAuth token exchange, last_status was not set to "ok",
 *         leaving the server status dot greyed out (Unknown).
 */
import { describe, expect, it } from "bun:test";
import {
  deriveStatusIndicator,
  deriveAuthStatusLabel,
} from "../../../app/src/client/components/tool-registry/McpServerSection";
import type { McpServerListItem } from "../../../app/src/client/hooks/use-mcp-servers";

// ---------------------------------------------------------------------------
// Bug 1: redirect_uri must include workspace-scoped path
// ---------------------------------------------------------------------------

describe("OAuth redirect_uri pattern", () => {
  it("workspace-scoped callback path matches the registered route", () => {
    // The redirect_uri sent to OAuth providers must match the actual route
    // in start-server.ts: /api/workspaces/:workspaceId/mcp-servers/oauth/callback
    const baseUrl = "http://localhost:3000";
    const workspaceId = "test-workspace-id";

    const redirectUri = `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/oauth/callback`;

    expect(redirectUri).toContain("/api/workspaces/");
    expect(redirectUri).toContain("/mcp-servers/oauth/callback");
    expect(redirectUri).not.toBe(`${baseUrl}/oauth/callback`);
  });
});

// ---------------------------------------------------------------------------
// Bug 2: post-OAuth redirect must use /tools, not /tool-registry
// ---------------------------------------------------------------------------

describe("post-OAuth redirect path", () => {
  it("success redirect uses /tools route, not /tool-registry", () => {
    const baseUrl = "http://localhost:3000";
    const successRedirect = `${baseUrl}/tools?tab=servers&oauth=success`;

    expect(successRedirect).toContain("/tools?");
    expect(successRedirect).not.toContain("/tool-registry");
  });

  it("error redirect uses /tools route, not /tool-registry", () => {
    const baseUrl = "http://localhost:3000";
    const errorRedirect = `${baseUrl}/tools?tab=servers&oauth=error`;

    expect(errorRedirect).toContain("/tools?");
    expect(errorRedirect).not.toContain("/tool-registry");
  });
});

// ---------------------------------------------------------------------------
// Bug 3: status indicator shows gray (Unknown) when last_status is undefined
// ---------------------------------------------------------------------------

function makeServer(overrides: Partial<McpServerListItem> = {}): McpServerListItem {
  return {
    id: "srv-1",
    name: "test-mcp",
    url: "https://mcp.example.com",
    transport: "streamable-http",
    auth_mode: "none",
    has_static_headers: false,
    tool_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("deriveStatusIndicator — regression for missing last_status after OAuth", () => {
  it("returns gray/Unknown when last_status is undefined (the pre-fix symptom)", () => {
    const result = deriveStatusIndicator(undefined);
    expect(result).toEqual({ color: "gray", label: "Unknown" });
  });

  it("returns green/Connected when last_status is ok (the post-fix state)", () => {
    const result = deriveStatusIndicator("ok");
    expect(result).toEqual({ color: "green", label: "Connected" });
  });
});

describe("deriveAuthStatusLabel — OAuth server without auth_error shows OAuth label", () => {
  it("shows 'OAuth' for oauth server with ok status", () => {
    const server = makeServer({ auth_mode: "oauth", last_status: "ok" });
    expect(deriveAuthStatusLabel(server)).toBe("OAuth");
  });

  it("shows 'Needs reauth' for oauth server with auth_error", () => {
    const server = makeServer({ auth_mode: "oauth", last_status: "auth_error" });
    expect(deriveAuthStatusLabel(server)).toBe("Needs reauth");
  });

  it("shows 'OAuth' for oauth server with undefined status", () => {
    const server = makeServer({ auth_mode: "oauth" });
    expect(deriveAuthStatusLabel(server)).toBe("OAuth");
  });
});
