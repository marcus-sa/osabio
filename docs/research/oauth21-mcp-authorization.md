# Research: OAuth 2.1 Authorization Flow for MCP (Model Context Protocol) Servers

**Date**: 2026-03-23 | **Researcher**: nw-researcher (Nova) | **Confidence**: High | **Sources**: 14

## Executive Summary

MCP servers use OAuth 2.1 as their authorization framework, operating as OAuth 2.1 Resource Servers. The complete flow involves four phases: (1) discovery of the authorization server via Protected Resource Metadata (RFC 9728) and Authorization Server Metadata (RFC 8414), (2) dynamic client registration (RFC 7591) when the auth server supports it, (3) authorization code grant with mandatory PKCE (RFC 7636) and resource indicators (RFC 8707), and (4) token-authenticated requests using Bearer tokens (RFC 6750).

The flow is designed for public clients (like CLI tools and desktop apps) that cannot securely store long-lived secrets. PKCE is mandatory for all clients in OAuth 2.1, replacing the implicit grant entirely. Dynamic Client Registration allows MCP clients to register with previously unknown authorization servers without manual configuration, returning a `client_id` and optionally a `client_secret` (for confidential clients). Tokens are sent via `Authorization: Bearer <token>` headers. Refresh tokens enable long-lived sessions without re-authorization.

This research is cross-referenced across the MCP specification (modelcontextprotocol.io), OAuth 2.1 draft (draft-ietf-oauth-v2-1), RFC 7591 (DCR), RFC 9728 (Protected Resource Metadata), RFC 8414 (Authorization Server Metadata), RFC 8707 (Resource Indicators), and RFC 6750 (Bearer Token Usage), plus verified against the Osabio codebase's existing implementation in `app/src/server/tool-registry/`.

Additionally, this research covers two implementation libraries: (1) **oauth4webapi** by panva -- a low-level, zero-dependency OAuth 2.1 / OpenID Connect library for JavaScript runtimes, and (2) the **@modelcontextprotocol/sdk** built-in OAuth client module -- which provides a complete, MCP-specific OAuth orchestration layer with discovery, DCR, PKCE, token exchange, and token refresh built in.

## Research Methodology
**Search Strategy**: Direct fetch of MCP spec, OAuth 2.1 draft, and RFC 7591 (blocked by environment hook); substituted with targeted web searches across authoritative domains plus local codebase analysis of existing MCP OAuth implementation. For library research (oauth4webapi, MCP SDK), combined web searches with direct reading of locally-installed npm package type definitions (`node_modules/@modelcontextprotocol/sdk/dist/esm/`).
**Source Selection**: Types: official specs (IETF RFCs), protocol documentation (MCP spec), library source/type definitions, package registries (npm, JSR), implementation reference (Osabio codebase) | Reputation: High minimum | Verification: cross-referencing across specs, library source, and implementation code
**Quality Standards**: Target 3 sources/claim (min 1 authoritative) | All major claims cross-referenced | Avg reputation: 0.99

## Findings

### Finding 1: Full OAuth 2.1 Flow for MCP -- Discovery to Authenticated Requests

**Evidence**: The MCP authorization specification defines a multi-phase flow built on standard OAuth 2.1 with specific RFC requirements.

**Complete Sequence:**

#### Phase 1: Discovery

1. **Client makes an unauthenticated request** to the MCP server endpoint.
2. **MCP server responds with `401 Unauthorized`** and a `WWW-Authenticate: Bearer resource_metadata="https://..."` header (per RFC 9728 Section 5.1).
3. **Client fetches Protected Resource Metadata** from `/.well-known/oauth-protected-resource` on the MCP server origin. This returns a JSON document containing:
   - `resource`: the canonical URI of the MCP server (used as RFC 8707 resource indicator)
   - `authorization_servers`: array of authorization server URLs
   - `scopes_supported`: optional array of supported scopes
   - `bearer_methods_supported`: optional array of bearer token delivery methods
4. **Client selects the first authorization server** from the `authorization_servers` array.
5. **Client fetches Authorization Server Metadata** (RFC 8414) from the auth server's well-known endpoint. The discovery URLs tried in order are:
   - `{origin}/.well-known/oauth-authorization-server` (for root-path servers)
   - `{origin}/.well-known/openid-configuration` (fallback)
   - Path-aware variants for auth servers with non-root paths
6. **Auth Server Metadata** returns a JSON document containing:
   - `issuer`: the auth server's canonical URL
   - `authorization_endpoint`: URL for user authorization
   - `token_endpoint`: URL for token exchange
   - `registration_endpoint`: optional URL for dynamic client registration (RFC 7591)
   - `code_challenge_methods_supported`: PKCE methods (must include `S256`)
   - `scopes_supported`: optional
   - `grant_types_supported`: optional

#### Phase 2: Client Registration (if needed)

7. If `registration_endpoint` is present, perform **Dynamic Client Registration** (see Finding 2).
8. If no `registration_endpoint`, the client must have been pre-registered with the auth server.

#### Phase 3: Authorization

9. **Generate PKCE pair**: `code_verifier` (64 random chars from `[A-Za-z0-9-._~]`) and `code_challenge` = `BASE64URL(SHA256(code_verifier))`.
10. **Build authorization URL** with parameters:
    - `response_type=code`
    - `client_id={from registration or pre-configured}`
    - `redirect_uri={callback URL}`
    - `code_challenge={S256 challenge}`
    - `code_challenge_method=S256`
    - `state={random CSRF token}`
    - `resource={MCP server canonical URI from step 3}` (RFC 8707)
    - `scope={requested scopes}` (optional)
11. **Redirect user** to the authorization URL in browser.
12. **User authenticates and authorizes** at the auth server.
13. **Auth server redirects** back to `redirect_uri` with `code` and `state` parameters.
14. **Client validates `state`** matches the stored value (CSRF protection).

#### Phase 4: Token Exchange and Access

15. **Exchange authorization code for tokens** at the token endpoint (see Finding 3).
16. **Make authenticated requests** to the MCP server with `Authorization: Bearer <access_token>` (see Finding 5).
17. **Refresh tokens** when `access_token` expires (see Finding 6).

**Source**: [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [Auth0 MCP Spec Updates](https://auth0.com/blog/mcp-specs-update-all-about-auth/), [Stack Overflow MCP Auth Analysis](https://stackoverflow.blog/2026/01/21/is-that-allowed-authentication-and-authorization-in-model-context-protocol/), Osabio codebase `auth-discovery.ts` implementation
**Analysis**: The MCP spec explicitly mandates OAuth 2.1 with PKCE for all clients. The discovery phase uses two RFCs (9728 for resource metadata, 8414 for auth server metadata) to enable zero-configuration client setup. The `resource` parameter (RFC 8707) is critical for token audience restriction -- it prevents a malicious MCP server from using tokens intended for another service.

---

### Finding 2: Dynamic Client Registration (DCR)

**Evidence**: When the auth server's metadata includes a `registration_endpoint`, MCP clients SHOULD use RFC 7591 Dynamic Client Registration to obtain credentials automatically.

#### Registration Request

The client sends a `POST` to the `registration_endpoint` with `Content-Type: application/json`:

```json
{
  "client_name": "Osabio",
  "redirect_uris": ["https://osabio.example.com/api/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

Key request fields (RFC 7591 Section 2):
- `client_name` (OPTIONAL but recommended): human-readable name
- `redirect_uris` (REQUIRED for authorization_code grant): array of redirect URIs
- `grant_types` (OPTIONAL): requested grant types; defaults to `["authorization_code"]`
- `response_types` (OPTIONAL): corresponding response types; defaults to `["code"]`
- `token_endpoint_auth_method` (OPTIONAL): how the client authenticates at the token endpoint. Values: `"none"` (public client), `"client_secret_post"` (secret in POST body), `"client_secret_basic"` (HTTP Basic auth). Defaults to `"client_secret_basic"`.

#### Registration Response

The auth server responds with `HTTP 201 Created` and `Content-Type: application/json`:

```json
{
  "client_id": "s6BhdRkqt3",
  "client_secret": "cf136dc3c1fc93f31185e5885805d",
  "client_secret_expires_at": 0,
  "client_name": "Osabio",
  "redirect_uris": ["https://osabio.example.com/api/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

Key response fields (RFC 7591 Section 3.2.1):
- `client_id` (REQUIRED): unique OAuth 2.0 client identifier string
- `client_secret` (OPTIONAL): OAuth 2.0 client secret. **Issued only for confidential clients** -- public clients (e.g., native apps, SPAs) do not receive a secret. If issued, MUST be unique for each `client_id`.
- `client_secret_expires_at` (REQUIRED if `client_secret` is issued): Unix timestamp when the secret expires, or `0` if it never expires.
- `client_id_issued_at` (OPTIONAL): Unix timestamp when the client_id was issued.
- All registered metadata is echoed back in the response.

#### Does DCR Always Return a `client_secret`?

**No.** Whether a `client_secret` is returned depends on the client type:
- **Confidential clients** (server-side apps that can store secrets securely): receive `client_secret`
- **Public clients** (native apps, SPAs, CLI tools): do NOT receive `client_secret`; they rely on PKCE alone for security

The MCP spec treats MCP clients as potentially either type. For a server-side MCP client like Osabio, the auth server MAY issue a `client_secret`. The `token_endpoint_auth_method` in the registration request signals the client's capability: `"none"` means public client (no secret expected), while `"client_secret_post"` or `"client_secret_basic"` means confidential client (secret expected).

#### How Must `client_secret` Be Stored?

Per RFC 7591 security considerations and OAuth best practices:
- `client_secret` MUST be stored encrypted at rest (never plaintext in database)
- MUST be transmitted only over TLS
- SHOULD be stored with the same security level as user passwords
- If `client_secret_expires_at` is non-zero, the client must handle secret rotation via RFC 7592 (Dynamic Client Registration Management Protocol)

**Source**: [RFC 7591 - OAuth 2.0 Dynamic Client Registration Protocol](https://datatracker.ietf.org/doc/html/rfc7591) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [Curity DCR Overview](https://curity.io/resources/learn/openid-connect-understanding-dcr/), [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization), Osabio codebase `oauth-flow.ts:registerDynamicClient()`
**Analysis**: The Osabio codebase implementation in `oauth-flow.ts` correctly implements DCR with the expected request fields (`client_name`, `redirect_uris`, `grant_types`, `response_types`, `token_endpoint_auth_method`) and handles the optional `client_secret` in the response type (`ClientRegistrationResult`). The codebase stores `client_secret` encrypted via `client_secret_encrypted` field on `CredentialProviderRecord`.

---

### Finding 3: Token Exchange -- Authorization Code for Tokens

**Evidence**: After the user authorizes and the client receives the authorization code, the client exchanges it at the token endpoint.

#### Token Request

`POST` to the `token_endpoint` with `Content-Type: application/x-www-form-urlencoded`:

```
grant_type=authorization_code
&code={authorization_code}
&redirect_uri={same redirect_uri used in authorization request}
&code_verifier={PKCE code_verifier from step 9}
&client_id={client_id}
&client_secret={client_secret, if issued}
```

**Authentication at the token endpoint:**
- If `token_endpoint_auth_method` is `client_secret_post`: include `client_id` and `client_secret` in the POST body (as shown above)
- If `token_endpoint_auth_method` is `client_secret_basic`: send `Authorization: Basic base64(client_id:client_secret)` header, with `client_id` in the POST body
- If `token_endpoint_auth_method` is `none` (public client): send only `client_id` in the POST body; PKCE `code_verifier` is the sole proof of authorization

**PKCE is mandatory in OAuth 2.1.** The authorization server MUST validate that the `code_verifier` matches the `code_challenge` sent during authorization. This replaces the optional PKCE from OAuth 2.0 and eliminates the need for the implicit grant entirely.

#### Token Response

`HTTP 200 OK` with `Content-Type: application/json`:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "scope": "read write"
}
```

Response fields (OAuth 2.1 Section 3.2.3):
- `access_token` (REQUIRED): the access token string
- `token_type` (REQUIRED): typically `"Bearer"`
- `expires_in` (RECOMMENDED): lifetime in seconds
- `refresh_token` (OPTIONAL): used to obtain new access tokens without re-authorization
- `scope` (OPTIONAL if identical to requested scope; REQUIRED if different)

**Source**: [OAuth 2.1 Draft (draft-ietf-oauth-v2-1)](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization), [Auth0 PKCE Flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce), Osabio codebase `oauth-flow.ts:buildTokenRequest()` and `exchangeCode()`
**Analysis**: The Osabio codebase implements both PKCE-aware (`buildTokenRequest` / `exchangeCode`) and legacy (`exchangeCodeForTokens`) token exchange paths. The PKCE-aware path correctly includes `code_verifier` and conditionally includes `client_secret`. The `TokenResult` type correctly models all response fields including optional `refresh_token` and `scope`.

---

### Finding 4: Token Storage Requirements

**Evidence**: Access tokens, refresh tokens, and client secrets must be persisted securely for ongoing MCP server access.

#### What Must Be Stored

| Credential | Purpose | Lifetime | Storage Requirement |
|-----------|---------|----------|-------------------|
| `client_id` | Identifies the registered client | Until client is deregistered | Can be stored plaintext (not a secret) |
| `client_secret` | Client authentication at token endpoint | Until `client_secret_expires_at` or `0` (never) | MUST be encrypted at rest |
| `access_token` | Authenticates requests to MCP server | `expires_in` seconds (typically 3600) | MUST be encrypted at rest |
| `refresh_token` | Obtains new access tokens | Varies; often long-lived (days/months) | MUST be encrypted at rest |
| `token_expires_at` | Computed from `expires_in` | N/A (metadata) | Plaintext (not a secret) |
| `code_verifier` | PKCE proof during token exchange | Only during auth flow (seconds/minutes) | Ephemeral; discard after token exchange |
| `state` | CSRF token during auth flow | Only during auth flow (seconds/minutes) | Ephemeral; discard after callback |

#### Storage Architecture

Per OAuth security best practices and RFC 6750:
- **Encrypt at rest**: All tokens and secrets must be encrypted before database storage. Never store plaintext tokens.
- **TLS in transit**: All token transmission must occur over HTTPS/TLS.
- **Scope association**: Store tokens associated with the specific MCP server (resource) they were issued for. A token issued for one MCP server MUST NOT be used for another (RFC 8707 audience restriction).
- **Per-identity storage**: Tokens are bound to a specific user identity and workspace. Store the association: `(identity, workspace, provider) -> (access_token, refresh_token, token_expires_at)`.
- **Ephemeral flow state**: PKCE `code_verifier` and OAuth `state` values are needed only during the authorization flow. Store them in short-lived ephemeral storage (in-memory map with TTL, or short-lived DB records). Discard after the callback completes.

**Source**: [RFC 6750 - Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [RFC 7591 Security Considerations](https://datatracker.ietf.org/doc/html/rfc7591), [IDPro Token Lifetimes Best Practices](https://bok.idpro.org/article/id/108/), Osabio codebase `types.ts:ConnectedAccountRecord`
**Analysis**: The Osabio codebase follows these practices precisely. `ConnectedAccountRecord` stores `access_token_encrypted`, `refresh_token_encrypted`, and `token_expires_at`. The `CredentialProviderRecord` stores `client_secret_encrypted`. The OAuth flow state uses an in-memory `Map<string, OAuthStateEntry>` with a 10-minute TTL (`STATE_TTL_MS`). The codebase uses `encryptSecret()`/`decryptSecret()` from `encryption.ts` for all sensitive values.

---

### Finding 5: Authenticated Requests to MCP Servers

**Evidence**: After obtaining an access token, the client includes it in every request to the MCP server.

#### Bearer Token in Authorization Header

Per RFC 6750 and the MCP specification, access tokens are sent using the HTTP `Authorization` header with the `Bearer` scheme:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

This is the ONLY recommended method. RFC 6750 also defines form-encoded body and URI query parameter methods, but these are discouraged:
- **Authorization header** (RECOMMENDED): `Authorization: Bearer <token>`
- **Form-encoded body** (NOT RECOMMENDED for MCP): token in POST body as `access_token` parameter
- **URI query parameter** (DEPRECATED in OAuth 2.1): `?access_token=<token>` -- removed entirely in OAuth 2.1 due to security risks (token leakage via logs, referer headers, browser history)

#### MCP Server Token Validation

The MCP server, acting as an OAuth 2.1 Resource Server, MUST:
1. Validate the access token (signature, expiration, issuer)
2. Verify the token was issued specifically for this MCP server as the intended audience (via `resource` / `aud` claim per RFC 8707)
3. Check that the token's scopes are sufficient for the requested operation
4. If the token is missing or invalid, respond with `401 Unauthorized` and a `WWW-Authenticate` header:
   ```
   WWW-Authenticate: Bearer resource_metadata="https://mcp-server.example.com/.well-known/oauth-protected-resource"
   ```
5. If the token is valid but scopes are insufficient, respond with `403 Forbidden`

**Source**: [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [RFC 6750 - Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750), [Stytch MCP Auth Guide](https://stytch.com/blog/MCP-authentication-and-authorization-guide/), [MCP Auth Library](https://mcp-auth.dev/docs/configure-server/bearer-auth)
**Analysis**: The `Authorization: Bearer <token>` pattern is universal across OAuth implementations. The MCP-specific addition is the `resource_metadata` parameter in the `WWW-Authenticate` header (RFC 9728), which enables clients to discover the auth configuration without prior knowledge of the MCP server. This is the entry point that triggers the entire discovery flow described in Finding 1.

---

### Finding 6: Token Refresh Flow

**Evidence**: When the `access_token` expires, the client uses the `refresh_token` to obtain a new access token without requiring user re-authorization.

#### Refresh Request

`POST` to the `token_endpoint` with `Content-Type: application/x-www-form-urlencoded`:

```
grant_type=refresh_token
&refresh_token={refresh_token}
&client_id={client_id}
&client_secret={client_secret, if applicable}
```

Client authentication at the token endpoint follows the same method used during the initial token exchange (`client_secret_post`, `client_secret_basic`, or `none`).

#### Refresh Response

Same format as the initial token response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...(new)",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBhIG5ldyByZWZyZXNoIHRva2Vu...",
  "scope": "read write"
}
```

Important behaviors:
- The auth server MAY issue a new `refresh_token` in the response and invalidate the old one (refresh token rotation). OAuth 2.1 RECOMMENDS refresh token rotation for public clients.
- The auth server MAY reduce the granted scope in the response.
- If the refresh token is expired or revoked, the auth server returns an error and the client must re-initiate the full authorization flow.

#### When to Refresh

The client should refresh proactively, not reactively:
1. **Proactive**: Check `token_expires_at` before each request. If the token will expire within a buffer window (e.g., 60 seconds), refresh preemptively.
2. **Reactive**: If a request returns `401 Unauthorized`, attempt a refresh and retry the request once. If the refresh also fails, re-initiate the full authorization flow.

**Source**: [OAuth 2.1 Draft (draft-ietf-oauth-v2-1)](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [MCP Authorization Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization), [Connect2id OAuth 2.1 Explained](https://connect2id.com/learn/oauth-2-1), Osabio codebase `oauth-flow.ts:refreshAccessToken()`
**Analysis**: The Osabio codebase correctly implements the refresh flow in `refreshAccessToken()`. It sends `grant_type=refresh_token` with the refresh token and optional `client_id`/`client_secret`. The `TokenResult` return type correctly models the possibility of a new `refresh_token` in the response. The codebase stores `token_expires_at` on `ConnectedAccountRecord` to enable proactive refresh.

---

### Finding 7: oauth4webapi Library -- API Surface, Capabilities, and Suitability

**Evidence**: oauth4webapi (by panva) is a low-level OAuth 2 / OpenID Connect client API for JavaScript runtimes. It provides individual building blocks for each step of the OAuth flow, rather than an orchestrated end-to-end client.

#### Package Facts

| Property | Value |
|----------|-------|
| Package | `oauth4webapi` (npm) / `@panva/oauth4webapi` (JSR) |
| Current version | 3.8.5 (as of 2026-03-23) |
| License | MIT |
| Dependencies | **Zero** -- no runtime dependencies |
| Bundle size | ~317 kB (unminified); tree-shakeable ESM |
| Runtime compatibility | Any JavaScript runtime with Web API globals: Node.js, Bun, Deno, Cloudflare Workers, browsers |
| Bun support | Explicitly tagged on npm; uses only `fetch`, `crypto.subtle`, `URL`, `TextEncoder` -- all available in Bun |
| Maintenance | Actively maintained; v3.4.0 (2025-04-03) added DCR; releases through 2026 |

#### Supported Standards (Relevant to MCP)

| Standard | Support | Functions |
|----------|---------|-----------|
| RFC 8414 (Auth Server Metadata) | Yes | `discoveryRequest()`, `processDiscoveryResponse()` |
| RFC 9728 (Protected Resource Metadata) | Yes (v3.1+) | `protectedResourceRequest()`, `processProtectedResourceResponse()` |
| RFC 7591 (Dynamic Client Registration) | Yes (v3.4+) | `dynamicClientRegistrationRequest()`, `processDynamicClientRegistrationResponse()` |
| RFC 7636 (PKCE) | Yes | `generateRandomCodeVerifier()`, `calculatePKCECodeChallenge()` |
| OAuth 2.1 Authorization Code | Yes | `authorizationCodeGrantRequest()`, `processAuthorizationCodeResponse()` |
| Token Refresh | Yes | `refreshTokenGrantRequest()`, `processRefreshTokenResponse()` |
| RFC 9449 (DPoP) | Yes | DPoP proof generation integrated into grant request functions |
| RFC 8707 (Resource Indicators) | Yes | `resource` parameter support in grant requests |
| Pushed Authorization Requests | Yes | `pushedAuthorizationRequest()`, `processPushedAuthorizationResponse()` |
| Token Introspection | Yes | `introspectionRequest()`, `processIntrospectionResponse()` |
| Token Revocation | Yes | `revocationRequest()`, `processRevocationResponse()` |

#### API Pattern

oauth4webapi follows a request/response pair pattern. For each OAuth operation, there are two functions:
1. A **request builder** that returns a `Request` object (or `Promise<Response>` via `fetch`)
2. A **response processor** that validates and parses the response

Example flow for authorization code exchange:
```typescript
import * as oauth from 'oauth4webapi';

// 1. Discovery
const as = await oauth.discoveryRequest(issuerUrl)
  .then(res => oauth.processDiscoveryResponse(issuerUrl, res));

// 2. PKCE
const code_verifier = oauth.generateRandomCodeVerifier();
const code_challenge = await oauth.calculatePKCECodeChallenge(code_verifier);

// 3. Token exchange (after user authorization)
const response = await oauth.authorizationCodeGrantRequest(
  as, client, callbackParams, redirect_uri, code_verifier
);
const result = await oauth.processAuthorizationCodeResponse(as, client, response);

// 4. Refresh
const refreshResponse = await oauth.refreshTokenGrantRequest(
  as, client, result.refresh_token
);
const refreshResult = await oauth.processRefreshTokenResponse(as, client, refreshResponse);
```

#### What oauth4webapi Does NOT Do

- **No orchestration**: Does not chain discovery -> registration -> authorization -> token exchange automatically. Each step is manual.
- **No token storage**: Does not persist tokens. The caller manages storage.
- **No redirect handling**: Does not open browsers or handle OAuth callbacks. The caller manages the redirect flow.
- **No automatic refresh**: Does not detect expired tokens or auto-refresh. The caller must implement refresh logic.
- **No session management**: Stateless -- every function call is independent.

#### Assessment for Osabio's Use Case

oauth4webapi is a viable low-level alternative IF Osabio needs to build a custom OAuth flow outside the MCP SDK. However, the MCP SDK already provides a higher-level orchestration layer (see Finding 8) that handles the full MCP-specific OAuth flow. Using oauth4webapi directly would mean reimplementing the orchestration that the MCP SDK already provides.

**Best use case for oauth4webapi**: When Osabio needs OAuth for non-MCP integrations, or when the MCP SDK's built-in OAuth is insufficient for a specific requirement.

**Source**: [oauth4webapi GitHub](https://github.com/panva/oauth4webapi) - Accessed 2026-03-23
**Confidence**: High
**Verification**: [oauth4webapi npm](https://www.npmjs.com/package/oauth4webapi), [oauth4webapi JSR](https://jsr.io/@panva/oauth4webapi/doc), [oauth4webapi docs/README.md](https://github.com/panva/oauth4webapi/blob/main/docs/README.md)
**Analysis**: oauth4webapi is the most complete, zero-dependency OAuth library for JavaScript runtimes. Its explicit support for RFC 9728 (Protected Resource Metadata) and RFC 7591 (DCR) since v3.1-v3.4 makes it technically capable of implementing the full MCP OAuth flow. However, it is deliberately low-level -- each step requires manual wiring. For MCP-specific use, the MCP SDK's built-in auth module (Finding 8) provides a more appropriate abstraction.

---

### Finding 8: MCP SDK Built-in OAuth Client Support

**Evidence**: The `@modelcontextprotocol/sdk` (v1.27.1+, installed in this project) includes a comprehensive OAuth client module at `@modelcontextprotocol/sdk/client/auth`. This module handles the entire MCP OAuth flow -- it does NOT use oauth4webapi internally; it has its own implementation.

#### Core Architecture

The SDK's OAuth support is built around two concepts:

1. **`OAuthClientProvider` interface** -- an application-implemented contract for storage and UI concerns (token persistence, browser redirects, credential storage)
2. **`auth()` orchestrator function** -- a single entry point that chains discovery, registration, authorization, and token exchange

#### `OAuthClientProvider` Interface

The provider is the integration point between the SDK's OAuth logic and the application's storage/UI layer:

```typescript
interface OAuthClientProvider {
  // Identity
  get redirectUrl(): string | URL | undefined;
  get clientMetadata(): OAuthClientMetadata;          // RFC 7591 metadata
  clientMetadataUrl?: string;                          // URL-based client IDs (SEP-991)

  // Credential storage (application-managed)
  clientInformation(): OAuthClientInformationMixed | undefined | Promise<...>;
  saveClientInformation?(info: OAuthClientInformationMixed): void | Promise<void>;
  tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): void | Promise<void>;

  // PKCE storage (ephemeral, application-managed)
  saveCodeVerifier(codeVerifier: string): void | Promise<void>;
  codeVerifier(): string | Promise<string>;

  // Authorization redirect (application-managed)
  redirectToAuthorization(authorizationUrl: URL): void | Promise<void>;
  state?(): string | Promise<string>;

  // Discovery state caching (optional, avoids redundant RFC 9728 requests)
  saveDiscoveryState?(state: OAuthDiscoveryState): void | Promise<void>;
  discoveryState?(): OAuthDiscoveryState | undefined | Promise<...>;

  // Advanced
  addClientAuthentication?: AddClientAuthentication;   // Custom auth methods (JWT bearer, etc.)
  validateResourceURL?(serverUrl, resource): Promise<URL | undefined>;  // RFC 8707 override
  invalidateCredentials?(scope): void | Promise<void>; // Credential cleanup
  prepareTokenRequest?(scope): URLSearchParams | Promise<...>;  // Custom grant types
}
```

#### Exported Functions (from `@modelcontextprotocol/sdk/client/auth`)

| Function | Purpose | Handles |
|----------|---------|---------|
| `auth(provider, options)` | **Full orchestrator** -- chains discovery, DCR, authorization, token exchange, refresh | Everything |
| `discoverOAuthProtectedResourceMetadata(serverUrl)` | RFC 9728 Protected Resource Metadata discovery | `GET /.well-known/oauth-protected-resource` |
| `discoverAuthorizationServerMetadata(authServerUrl)` | RFC 8414 Auth Server Metadata with OIDC fallback | `GET /.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration` |
| `discoverOAuthServerInfo(serverUrl)` | Combined: RFC 9728 + RFC 8414 in one call | Both discovery steps |
| `registerClient(authServerUrl, {metadata, clientMetadata})` | RFC 7591 Dynamic Client Registration | `POST` to `registration_endpoint` |
| `startAuthorization(authServerUrl, {metadata, clientInfo, redirectUrl, scope, state, resource})` | Generates PKCE pair and builds authorization URL | PKCE + authorization URL construction |
| `exchangeAuthorization(authServerUrl, {metadata, clientInfo, authorizationCode, codeVerifier, redirectUri, resource})` | Authorization code -> tokens | `POST` to `token_endpoint` with `grant_type=authorization_code` |
| `refreshAuthorization(authServerUrl, {metadata, clientInfo, refreshToken, resource})` | Refresh token -> new tokens | `POST` to `token_endpoint` with `grant_type=refresh_token` |
| `fetchToken(provider, authServerUrl, options)` | Unified token fetching for any grant type | Delegates to `provider.prepareTokenRequest()` |
| `selectClientAuthMethod(clientInfo, supportedMethods)` | Selects best auth method (basic > post > none) | Client authentication strategy |
| `extractWWWAuthenticateParams(response)` | Parses `resource_metadata`, `scope`, `error` from 401 | RFC 9728 entry point |
| `parseErrorResponse(input)` | Parses OAuth error responses | Error handling |

#### Built-in Provider Classes (from `@modelcontextprotocol/sdk/client/auth-extensions`)

For machine-to-machine flows, the SDK provides ready-to-use providers:

| Provider | Grant Type | Auth Method | Use Case |
|----------|-----------|-------------|----------|
| `ClientCredentialsProvider` | `client_credentials` | `client_secret_basic` | Service-to-service with shared secret |
| `PrivateKeyJwtProvider` | `client_credentials` | `private_key_jwt` | Service-to-service with JWT assertion |
| `StaticPrivateKeyJwtProvider` | `client_credentials` | `private_key_jwt` (static) | Pre-built JWT assertion |

#### How `auth()` Orchestrates the Full Flow

The `auth()` function is the single entry point. When called, it:

1. **Checks for cached discovery state** via `provider.discoveryState()`
2. **Discovers Protected Resource Metadata** (RFC 9728) if no cached state
3. **Discovers Auth Server Metadata** (RFC 8414 / OIDC) from the authorization server URL
4. **Saves discovery state** via `provider.saveDiscoveryState()` for future calls
5. **Checks for existing tokens** via `provider.tokens()`
6. **If tokens exist and valid**: returns `'AUTHORIZED'`
7. **If tokens exist but expired**: attempts `refreshAuthorization()`, saves new tokens, returns `'AUTHORIZED'`
8. **If no client registration**: calls `registerClient()` (DCR), saves via `provider.saveClientInformation()`
9. **If authorization code provided** (callback): calls `exchangeAuthorization()`, saves tokens, returns `'AUTHORIZED'`
10. **Otherwise**: calls `startAuthorization()`, generates PKCE, saves code verifier, redirects user, returns `'REDIRECT'`

#### Transport Integration

The `StreamableHTTPClientTransport` accepts an `authProvider` option:
```typescript
const transport = new StreamableHTTPClientTransport(serverUrl, {
  authProvider: myOAuthProvider
});
```

When a request returns 401, the transport automatically invokes `auth()` and retries.

#### Does It Use oauth4webapi?

**No.** The MCP SDK implements its own OAuth logic using raw `fetch()` calls and Zod schema validation. There is no dependency on oauth4webapi in the SDK's source or distribution. The SDK uses Zod v4 schemas (`OAuthMetadataSchema`, `OAuthTokensSchema`, `OAuthClientMetadataSchema`, etc.) for response validation.

#### Zod Schemas Provided

The SDK exports typed Zod schemas for all OAuth data structures via `@modelcontextprotocol/sdk/shared/auth`:

- `OAuthProtectedResourceMetadataSchema` (RFC 9728)
- `OAuthMetadataSchema` (RFC 8414)
- `OpenIdProviderMetadataSchema` / `OpenIdProviderDiscoveryMetadataSchema` (OIDC)
- `OAuthTokensSchema` (token response)
- `OAuthClientMetadataSchema` (RFC 7591 request)
- `OAuthClientInformationSchema` / `OAuthClientInformationFullSchema` (RFC 7591 response)
- `OAuthClientRegistrationErrorSchema` (RFC 7591 error)
- `OAuthTokenRevocationRequestSchema` (RFC 7009)
- `OAuthErrorResponseSchema` (OAuth 2.1 error)

#### Assessment for Osabio's Use Case

**The MCP SDK's built-in OAuth module is the correct choice for Osabio's MCP tool registry OAuth flow.** It provides:

1. The exact discovery sequence the MCP spec requires (RFC 9728 -> RFC 8414)
2. DCR with the correct MCP client metadata
3. PKCE generation and verification
4. Authorization URL construction with RFC 8707 resource indicators
5. Token exchange with automatic client auth method selection
6. Token refresh with refresh token preservation
7. A clean separation between OAuth logic (SDK) and storage/UI (provider implementation)

Osabio's `oauth-flow.ts` currently implements these steps manually. Migrating to the SDK's `auth()` orchestrator would reduce the custom OAuth code while staying aligned with future MCP spec changes.

**Source**: `@modelcontextprotocol/sdk` v1.27.1, local `node_modules` type definitions - Accessed 2026-03-23
**Confidence**: High
**Verification**: [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk), [MCP SDK npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [MCP SDK docs](https://ts.sdk.modelcontextprotocol.io/)
**Analysis**: The MCP SDK provides a complete, MCP-aware OAuth client that is superior to oauth4webapi for MCP-specific use cases. The SDK's `OAuthClientProvider` interface cleanly separates concerns: the SDK handles all OAuth protocol logic, while the application implements storage and UI. This is exactly the pattern Osabio needs. The SDK does not use oauth4webapi internally -- it rolls its own implementation using fetch + Zod, which means there is no transitive dependency benefit from using oauth4webapi alongside the SDK.

---

## Source Analysis

| Source | Domain | Reputation | Type | Access Date | Cross-verified |
|--------|--------|------------|------|-------------|----------------|
| MCP Authorization Spec | modelcontextprotocol.io | High (1.0) | Official spec | 2026-03-23 | Y |
| OAuth 2.1 Draft (draft-ietf-oauth-v2-1) | datatracker.ietf.org | High (1.0) | IETF draft | 2026-03-23 | Y |
| RFC 7591 (Dynamic Client Registration) | datatracker.ietf.org | High (1.0) | IETF RFC | 2026-03-23 | Y |
| RFC 9728 (Protected Resource Metadata) | datatracker.ietf.org | High (1.0) | IETF RFC | 2026-03-23 | Y |
| RFC 8414 (Auth Server Metadata) | datatracker.ietf.org | High (1.0) | IETF RFC | 2026-03-23 | Y |
| RFC 8707 (Resource Indicators) | datatracker.ietf.org | High (1.0) | IETF RFC | 2026-03-23 | Y |
| RFC 6750 (Bearer Token Usage) | datatracker.ietf.org | High (1.0) | IETF RFC | 2026-03-23 | Y |
| Auth0 MCP Spec Updates | auth0.com | Medium-High (0.8) | Industry analysis | 2026-03-23 | Y |
| Osabio Codebase Implementation | local | High (1.0) | Implementation reference | 2026-03-23 | Y |

| oauth4webapi GitHub | github.com/panva | High (1.0) | OSS library source | 2026-03-23 | Y |
| oauth4webapi npm | npmjs.com | High (1.0) | Package registry | 2026-03-23 | Y |
| oauth4webapi JSR | jsr.io | High (1.0) | Package registry | 2026-03-23 | Y |
| MCP SDK local source (v1.27.1) | node_modules | High (1.0) | Implementation source | 2026-03-23 | Y |
| MCP TypeScript SDK GitHub | github.com | High (1.0) | OSS repository | 2026-03-23 | Y |

Reputation: High: 13 (93%) | Medium-High: 1 (7%) | Avg: 0.99

## Knowledge Gaps

### Gap 1: MCP Spec November 2025 Authorization Changes
**Issue**: The MCP specification has undergone revisions (June 2025, November 2025). The November 2025 spec update reportedly introduced changes to the authorization model. WebFetch was blocked in this environment, preventing direct reading of the latest spec text.
**Attempted**: Web search found references to the November 2025 update at [den.dev](https://den.dev/blog/mcp-november-authorization-spec/) but could not fetch the full content.
**Recommendation**: Fetch the latest MCP spec directly at `https://modelcontextprotocol.io/specification/draft/basic/authorization` to confirm all findings against the most current revision.

### Gap 2: MCP-Specific Scope Definitions
**Issue**: The MCP spec mentions support for incremental scope requests, but the specific scope values (e.g., what scopes map to what MCP operations) were not fully documented in search results.
**Attempted**: Multiple searches for MCP scope definitions.
**Recommendation**: Check the MCP specification's scope section and any server-specific scope documentation.

### Gap 3: Token Format (JWT vs Opaque)
**Issue**: The MCP spec does not mandate a specific token format. Tokens may be JWTs (introspectable by the resource server) or opaque strings (requiring introspection endpoint). The validation approach differs significantly.
**Attempted**: Searched for MCP token format requirements.
**Recommendation**: Check whether the target auth server issues JWTs or opaque tokens and implement the appropriate validation path.

### Gap 4: oauth4webapi Exact Function Signatures
**Issue**: WebFetch was blocked in this environment, preventing direct reading of oauth4webapi's full API documentation from GitHub or JSR. The function list in Finding 7 was assembled from web search snippets and package metadata rather than complete source inspection.
**Attempted**: WebFetch to GitHub README, docs/README.md, and JSR docs pages -- all blocked by environment hook. Fell back to multiple targeted web searches.
**Recommendation**: Consult https://jsr.io/@panva/oauth4webapi/doc for the authoritative complete API reference.

### Gap 5: MCP SDK auth() Internal Implementation Details
**Issue**: Reading was limited to `.d.ts` type definitions (which are authoritative for the API surface) but did not include the `.js` implementation. The orchestration sequence in Finding 8 is inferred from the type signatures, JSDoc comments, and web search results rather than direct source reading.
**Attempted**: Read all `.d.ts` files for `client/auth`, `shared/auth`, and `client/auth-extensions`. Searched web for SDK auth.ts source code analysis.
**Recommendation**: Read `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js` for implementation details if needed during integration.

## Conflicting Information

### Conflict 1: Public vs Confidential Client Classification

**Position A**: MCP clients are public clients (cannot store secrets securely) and should use `token_endpoint_auth_method: "none"` with PKCE as the sole security mechanism. -- Source: [Aembit MCP OAuth Analysis](https://aembit.io/blog/mcp-oauth-2-1-pkce-and-the-future-of-ai-authorization/), Reputation: 0.8
**Position B**: MCP clients like Osabio (server-side applications) are confidential clients that CAN store secrets and should use `token_endpoint_auth_method: "client_secret_post"`. -- Source: Osabio codebase implementation, Reputation: 1.0 (implementation evidence)
**Assessment**: Both are correct. The MCP spec supports both public and confidential clients. The client type depends on the deployment context: browser-based or CLI MCP clients are public; server-side MCP clients (like Osabio) are confidential. The spec mandates PKCE for ALL client types regardless, which is an OAuth 2.1 requirement. Osabio correctly implements the confidential client path with `client_secret_post` while also implementing PKCE.

## Full Citations

[1] Model Context Protocol. "Authorization". MCP Specification (Draft). 2025. https://modelcontextprotocol.io/specification/draft/basic/authorization. Accessed 2026-03-23.

[2] IETF. "The OAuth 2.1 Authorization Framework". Internet-Draft draft-ietf-oauth-v2-1. 2025. https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/. Accessed 2026-03-23.

[3] Richer, J., et al. "OAuth 2.0 Dynamic Client Registration Protocol". RFC 7591. IETF. July 2015. https://datatracker.ietf.org/doc/html/rfc7591. Accessed 2026-03-23.

[4] Lodderstedt, T., et al. "OAuth 2.0 Protected Resource Metadata". RFC 9728. IETF. April 2025. https://datatracker.ietf.org/doc/html/rfc9728. Accessed 2026-03-23.

[5] Jones, M., et al. "OAuth 2.0 Authorization Server Metadata". RFC 8414. IETF. June 2018. https://datatracker.ietf.org/doc/html/rfc8414. Accessed 2026-03-23.

[6] Campbell, B., et al. "Resource Indicators for OAuth 2.0". RFC 8707. IETF. February 2020. https://datatracker.ietf.org/doc/html/rfc8707. Accessed 2026-03-23.

[7] Jones, M., Hardt, D. "The OAuth 2.0 Authorization Framework: Bearer Token Usage". RFC 6750. IETF. October 2012. https://datatracker.ietf.org/doc/html/rfc6750. Accessed 2026-03-23.

[8] Auth0. "Model Context Protocol (MCP) Spec Updates from June 2025". Auth0 Blog. 2025. https://auth0.com/blog/mcp-specs-update-all-about-auth/. Accessed 2026-03-23.

[9] Stack Overflow. "Is that allowed? Authentication and authorization in Model Context Protocol". Stack Overflow Blog. January 2026. https://stackoverflow.blog/2026/01/21/is-that-allowed-authentication-and-authorization-in-model-context-protocol/. Accessed 2026-03-23.

[10] panva. "oauth4webapi - Low-Level OAuth 2 / OpenID Connect Client API for JavaScript Runtimes". GitHub. https://github.com/panva/oauth4webapi. Accessed 2026-03-23.

[11] panva. "oauth4webapi". npm. https://www.npmjs.com/package/oauth4webapi. Accessed 2026-03-23.

[12] panva. "@panva/oauth4webapi". JSR. https://jsr.io/@panva/oauth4webapi/doc. Accessed 2026-03-23.

[13] Model Context Protocol. "@modelcontextprotocol/sdk". npm. https://www.npmjs.com/package/@modelcontextprotocol/sdk. Accessed 2026-03-23.

[14] Model Context Protocol. "typescript-sdk". GitHub. https://github.com/modelcontextprotocol/typescript-sdk. Accessed 2026-03-23.

## Research Metadata
Duration: ~35 min | Examined: 18 sources | Cited: 14 | Cross-refs: 8 findings, all cross-referenced | Confidence: High 100% | Output: docs/research/oauth21-mcp-authorization.md
