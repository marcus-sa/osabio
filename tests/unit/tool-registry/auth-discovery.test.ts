/**
 * Unit tests for auth-discovery pure parsing functions.
 *
 * Tests: parseProtectedResourceMetadata, parseAuthServerMetadata,
 *        deriveDiscoveryEndpoints, deriveResourceMetadataUrl, selectAuthorizationServer
 */
import { describe, expect, it } from "bun:test";
import {
  parseProtectedResourceMetadata,
  parseAuthServerMetadata,
  deriveDiscoveryEndpoints,
  deriveResourceMetadataUrl,
  selectAuthorizationServer,
} from "../../../app/src/server/tool-registry/auth-discovery";

// ---------------------------------------------------------------------------
// parseProtectedResourceMetadata
// ---------------------------------------------------------------------------
describe("parseProtectedResourceMetadata", () => {
  it("extracts resource, authorization_servers, and scopes from valid metadata", () => {
    const json = {
      resource: "https://mcp.example.com",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["tools:read", "tools:execute"],
      bearer_methods_supported: ["header"],
    };

    const result = parseProtectedResourceMetadata(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resource).toBe("https://mcp.example.com");
      expect(result.value.authorization_servers).toEqual(["https://auth.example.com"]);
      expect(result.value.scopes_supported).toEqual(["tools:read", "tools:execute"]);
    }
  });

  it("rejects metadata missing resource field", () => {
    const json = {
      authorization_servers: ["https://auth.example.com"],
    };

    const result = parseProtectedResourceMetadata(json);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("resource");
    }
  });

  it("rejects metadata with empty authorization_servers", () => {
    const json = {
      resource: "https://mcp.example.com",
      authorization_servers: [],
    };

    const result = parseProtectedResourceMetadata(json);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("authorization_servers");
    }
  });

  it("rejects non-object input", () => {
    const result = parseProtectedResourceMetadata("not an object");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAuthServerMetadata
// ---------------------------------------------------------------------------
describe("parseAuthServerMetadata", () => {
  it("extracts endpoints from valid auth server metadata", () => {
    const json = {
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      registration_endpoint: "https://auth.example.com/register",
      scopes_supported: ["tools:read"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code"],
    };

    const result = parseAuthServerMetadata(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.issuer).toBe("https://auth.example.com");
      expect(result.value.authorization_endpoint).toBe("https://auth.example.com/authorize");
      expect(result.value.token_endpoint).toBe("https://auth.example.com/token");
      expect(result.value.registration_endpoint).toBe("https://auth.example.com/register");
      expect(result.value.code_challenge_methods_supported).toEqual(["S256"]);
    }
  });

  it("rejects metadata missing authorization_endpoint", () => {
    const json = {
      issuer: "https://auth.example.com",
      token_endpoint: "https://auth.example.com/token",
      response_types_supported: ["code"],
    };

    const result = parseAuthServerMetadata(json);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("authorization_endpoint");
    }
  });

  it("rejects metadata missing token_endpoint", () => {
    const json = {
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      response_types_supported: ["code"],
    };

    const result = parseAuthServerMetadata(json);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("token_endpoint");
    }
  });
});

// ---------------------------------------------------------------------------
// deriveDiscoveryEndpoints
// ---------------------------------------------------------------------------
describe("deriveDiscoveryEndpoints", () => {
  it("returns two well-known URLs for issuer without path", () => {
    const endpoints = deriveDiscoveryEndpoints("https://auth.example.com");

    expect(endpoints).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
  });

  it("returns three well-known URLs for issuer with path component", () => {
    const endpoints = deriveDiscoveryEndpoints("https://auth.example.com/tenant1");

    expect(endpoints).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
  });

  it("strips trailing slash before deriving", () => {
    const endpoints = deriveDiscoveryEndpoints("https://auth.example.com/");

    expect(endpoints).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
  });
});

// ---------------------------------------------------------------------------
// deriveResourceMetadataUrl
// ---------------------------------------------------------------------------
describe("deriveResourceMetadataUrl", () => {
  it("appends .well-known/oauth-protected-resource to server origin", () => {
    const url = deriveResourceMetadataUrl("https://mcp.example.com");
    expect(url).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
  });

  it("handles server URL with path", () => {
    const url = deriveResourceMetadataUrl("https://mcp.example.com/v1/mcp");
    expect(url).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
  });
});

// ---------------------------------------------------------------------------
// selectAuthorizationServer
// ---------------------------------------------------------------------------
describe("selectAuthorizationServer", () => {
  it("selects the first server from the list", () => {
    const result = selectAuthorizationServer([
      "https://auth1.example.com",
      "https://auth2.example.com",
    ]);
    expect(result).toBe("https://auth1.example.com");
  });

  it("returns undefined for empty list", () => {
    const result = selectAuthorizationServer([]);
    expect(result).toBeUndefined();
  });
});
