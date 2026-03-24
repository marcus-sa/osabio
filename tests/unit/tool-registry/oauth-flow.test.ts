/**
 * Unit tests for legacy OAuth flow helpers (credential provider connect flow).
 * MCP server OAuth is tested via mcp-oauth and server-routes acceptance tests.
 */
import { describe, expect, it } from "bun:test";
import { buildAuthorizationUrl, storeOAuthState, consumeOAuthState } from "../../../app/src/server/tool-registry/oauth-flow";
import type { CredentialProviderRecord } from "../../../app/src/server/tool-registry/types";
import { RecordId } from "surrealdb";

describe("buildAuthorizationUrl (legacy provider)", () => {
  const provider: CredentialProviderRecord = {
    id: new RecordId("credential_provider", "test-id"),
    name: "test-provider",
    display_name: "Test Provider",
    auth_method: "oauth2",
    authorization_url: "https://auth.example.com/authorize",
    token_url: "https://auth.example.com/token",
    client_id: "test-client-123",
    workspace: new RecordId("workspace", "ws-1"),
    created_at: new Date(),
    scopes: ["read", "write"],
  };

  it("includes client_id, redirect_uri, response_type, state", () => {
    const urlString = buildAuthorizationUrl(provider, "https://brain.local/callback", "state-abc");
    const url = new URL(urlString);

    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://brain.local/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("scope")).toBe("read write");
  });

  it("omits scope when provider has no scopes", () => {
    const noScopes = { ...provider, scopes: undefined };
    const urlString = buildAuthorizationUrl(noScopes, "https://brain.local/callback", "s");
    const url = new URL(urlString);

    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("throws when authorization_url is missing", () => {
    const noAuthUrl = { ...provider, authorization_url: undefined };
    expect(() => buildAuthorizationUrl(noAuthUrl, "https://brain.local/callback", "s"))
      .toThrow("Provider missing authorization_url");
  });

  it("throws when client_id is missing", () => {
    const noClientId = { ...provider, client_id: undefined };
    expect(() => buildAuthorizationUrl(noClientId, "https://brain.local/callback", "s"))
      .toThrow("Provider missing client_id");
  });
});

describe("storeOAuthState / consumeOAuthState", () => {
  it("stores and consumes a state entry", () => {
    const state = `test-state-${crypto.randomUUID()}`;
    storeOAuthState(state, {
      providerId: "p1",
      identityId: "i1",
      workspaceId: "w1",
      createdAt: Date.now(),
    });

    const entry = consumeOAuthState(state);
    expect(entry).toBeDefined();
    expect(entry!.providerId).toBe("p1");

    // Second consume returns undefined (already consumed)
    expect(consumeOAuthState(state)).toBeUndefined();
  });

  it("returns undefined for unknown state", () => {
    expect(consumeOAuthState("nonexistent")).toBeUndefined();
  });
});
