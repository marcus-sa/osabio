/**
 * Acceptance Tests: Credential Resolver Dispatch (US-1, US-3)
 *
 * Milestone 4: The credential resolver dispatches on auth_mode to produce
 * the correct HTTP headers for MCP client connections.
 *
 * Traces: US-1, US-3, FR-1, FR-3
 * Driving port: MCP client factory (internal — resolver is called before transport creation)
 *
 * Implementation sequence:
 *   1. No-auth server resolves to empty headers                    [@skip]
 *   2. Static headers server resolves to decrypted headers         [@skip]
 *   3. OAuth server resolves to Bearer token                       [@skip]
 *   4. Provider server resolves via existing credential flow       [@skip]
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedMcpServer,
} from "./mcp-server-auth-test-kit";

const getRuntime = setupAcceptanceSuite("mcp_server_auth_credential_resolver");

// ---------------------------------------------------------------------------
// Milestone 4: Credential Resolver Dispatch
// ---------------------------------------------------------------------------
describe("No-auth server resolves to empty headers", () => {
  it.skip("resolveAuthForMcpServer returns {} for auth_mode none", async () => {
    // Given MCP server with auth_mode = "none"
    // When credential resolver resolves auth
    // Then returned headers map is empty
  }, 30_000);
});

describe("Static headers server resolves to decrypted headers", () => {
  it.skip("resolveAuthForMcpServer decrypts and returns stored headers", async () => {
    // Given MCP server with auth_mode = "static_headers"
    // And static_headers = [{ name: "Authorization", value_encrypted: "..." }]
    // When credential resolver resolves auth
    // Then returned headers = { "Authorization": "Bearer ghp_test123" }
    // (decrypted from AES-256-GCM ciphertext)
  }, 30_000);
});

describe("OAuth server resolves to Bearer token", () => {
  it.skip("resolveAuthForMcpServer returns Authorization: Bearer from connected_account", async () => {
    // Given MCP server with auth_mode = "oauth"
    // And linked connected_account with valid access_token_encrypted
    // When credential resolver resolves auth
    // Then returned headers = { "Authorization": "Bearer <decrypted_token>" }
  }, 30_000);
});

describe("Provider server resolves via existing credential flow", () => {
  it.skip("resolveAuthForMcpServer delegates to existing credential_provider logic", async () => {
    // Given MCP server with auth_mode = "provider"
    // And linked credential_provider + connected_account
    // When credential resolver resolves auth
    // Then returned headers match existing credential resolution behavior
    // (This confirms backward compatibility — no behavior change for existing servers)
  }, 30_000);
});
