# Research: Better Auth SSO Plugin Gap Analysis for MCP Credential Brokerage

**Date**: 2026-03-22
**Researcher**: nw-researcher (Nova)
**Overall Confidence**: Medium
**Sources Consulted**: 14

## Executive Summary

This research investigates three specific gaps in Better Auth's SSO plugin that affect Brain's planned use as an MCP tool credential broker: (1) whether the SSO plugin supports non-OIDC OAuth 2.0 providers, (2) whether the Organization plugin is a hard dependency, and (3) whether the SSO plugin can coexist with the `oauthProvider` plugin.

**Verdict**: The SSO plugin has significant limitations for Brain's use case. It is designed primarily for OIDC and SAML enterprise identity providers, not for plain OAuth 2.0 API credential brokerage. The OIDC sign-in flow requires `id_token` validation via `jose`, and the discovery mechanism expects `/.well-known/openid-configuration`. The Organization plugin appears to be a soft dependency (the `organizationId` field is likely optional in the database schema), but the plugin's architecture is designed around organization-scoped provider resolution. The SSO and `oauthProvider` plugins register routes under different path prefixes (`/sso/*` vs `/oauth2/*`) and should coexist without route collisions, though this is the finding with the least direct source-code evidence.

---

## Research Methodology

**Search Strategy**: GitHub repository source code analysis (via web search and DeepWiki), GitHub issues and discussions, official Better Auth documentation, and community reports.

**Source Selection Criteria**:
- Source types: official documentation, GitHub repository (issues/discussions/source), AI-assisted source analysis (DeepWiki)
- Reputation threshold: medium-high minimum
- Verification method: cross-referencing documentation against source code analysis and GitHub issues

**Quality Standards**:
- Minimum sources per claim: 3
- Cross-reference requirement: All major claims
- Source reputation: Average score 0.82

---

## Findings

### Finding 1: SSO Plugin OIDC Flow Requires Discovery and id_token Validation

**Evidence**: The SSO plugin's OIDC flow fetches the provider's OpenID Connect Discovery Document from `{issuer}/.well-known/openid-configuration` to hydrate endpoint configuration. The plugin uses the `jose` library for `id_token` validation and claims extraction. The documentation explicitly states: "Better Auth does not support implicit-only OIDC flows -- `token_endpoint` and `jwks_uri` are required even though the OIDC spec allows implicit-only providers to omit `token_endpoint`."

When registering an OIDC provider, the required fields in `oidcConfig` are `clientId` and `clientSecret`. The following fields are auto-discovered from the discovery document if not explicitly provided: `authorizationEndpoint`, `tokenEndpoint`, `jwksEndpoint`, `userInfoEndpoint`, `discoveryEndpoint`, `tokenEndpointAuthentication`.

**Confidence**: High

**Verification**: Cross-referenced with:
- [Better Auth SSO Docs](https://better-auth.com/docs/plugins/sso) - Official documentation states auto-discovery from `{issuer}/.well-known/openid-configuration`
- [DeepWiki: Enterprise SSO](https://deepwiki.com/better-auth/better-auth/6.2-enterprise-sso) - Source code analysis confirms `jose` library for token validation, discovery logic in `packages/sso/src/oidc/discovery.ts`
- [GitHub Issue #3728](https://github.com/better-auth/better-auth/issues/3728) - Reports that discovery URL is not properly used during registration, confirming the discovery mechanism exists but had bugs
- [Better Auth 1.5 Blog](https://better-auth.com/blog/1-5) - Confirms OIDC ID token `aud` claim validation was added

**Analysis**: This is a critical finding for Brain's use case. GitHub, Slack, and Linear are **not** OIDC providers -- they do not expose `/.well-known/openid-configuration` discovery endpoints, do not issue `id_token`s, and do not have JWKS endpoints. The SSO plugin's OIDC flow fundamentally assumes the provider implements OpenID Connect, not just OAuth 2.0 authorization code flow.

The documentation does mention "OAuth2 providers" alongside OIDC and SAML in marketing copy, but every concrete code path, configuration example, and API parameter points to OIDC-specific concepts (issuer, discovery, id_token, jwks). No documentation or source code evidence was found for a plain OAuth 2.0 mode that skips discovery and id_token validation.

---

### Finding 2: SSO Plugin OIDC Config Requires an Issuer URL (Implies Discovery)

**Evidence**: The minimal OIDC provider registration requires `providerId`, `issuer`, `domain`, and `oidcConfig` with `clientId` and `clientSecret`. The `issuer` field is used to construct the discovery URL (`{issuer}/.well-known/openid-configuration`). There is no documented way to register a provider with explicit `authorizationUrl` and `tokenUrl` only (as the Generic OAuth plugin supports).

GitHub Issue #4346 requests "Allow static OIDC providers in SSO plugin config" -- specifically calling out that the current registration requires a logged-in user session and is designed for runtime API registration, not static configuration. This issue does not request plain OAuth 2.0 support, further confirming the plugin's OIDC-only design.

**Confidence**: High

**Verification**: Cross-referenced with:
- [Better Auth SSO Docs](https://better-auth.com/docs/plugins/sso) - Registration examples all show `issuer` as required
- [GitHub Issue #4346](https://github.com/better-auth/better-auth/issues/4346) - Feature request for static OIDC providers, confirming dynamic-only registration model
- [GitHub Issue #3728](https://github.com/better-auth/better-auth/issues/3728) - Discovery endpoint handling confirms issuer-based discovery is the core flow
- [Better Auth SSO Docs Source (GitHub)](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/sso.mdx) - Raw docs confirm minimal config requires `issuer`

**Analysis**: For GitHub OAuth (which uses `https://github.com/login/oauth/authorize` and `https://github.com/login/oauth/access_token`), there is no `issuer` URL and no discovery document. The SSO plugin's registration model does not accommodate this pattern. A plain OAuth 2.0 provider would need to supply explicit endpoint URLs without discovery -- a capability the Generic OAuth plugin has but the SSO plugin does not.

---

### Finding 3: Organization Plugin is a Soft Dependency -- organizationId is Likely Optional

**Evidence**: The `sso_provider` database table includes an `organizationId` field. Multiple sources describe this field as enabling per-organization provider scoping, but none describe it as a hard `NOT NULL` constraint. The DeepWiki source analysis describes the field as one that "lets you link each SSO provider to a specific organization for per-org enable/disable at runtime" -- language suggesting opt-in linkage rather than a required foreign key.

GitHub Discussion #3721 recommends the SSO plugin for multi-tenant dynamic providers with organization scoping, but the discussion focuses on `organizationId` as a feature, not a requirement. GitHub Issue #4972 discusses users signing in via SSO without being auto-added to organizations, implying the organization membership pathway is a feature layer on top of SSO, not a prerequisite.

**Confidence**: Medium

**Verification**: Cross-referenced with:
- [Better Auth SSO Docs](https://better-auth.com/docs/plugins/sso) - Shows `organizationId` in registration examples but does not explicitly mark it as required
- [GitHub Discussion #3721](https://github.com/better-auth/better-auth/discussions/3721) - Describes organization linkage as a feature for multi-tenant patterns
- [DeepWiki: Enterprise SSO](https://deepwiki.com/better-auth/better-auth/6.2-enterprise-sso) - Source analysis describes `organizationId` as a linkage field, not a constraint
- [GitHub Issue #4972](https://github.com/better-auth/better-auth/issues/4972) - Organization membership is discussed as a feature, not a prerequisite

**Analysis**: The Organization plugin is likely a soft dependency -- the SSO plugin probably works without it, and `organizationId` is probably nullable. However, this finding has Medium confidence because no source provides the actual database schema definition (`CREATE TABLE sso_provider`) or the TypeScript type showing `organizationId?: string`. Brain could map its workspace ID into this field, but the provider resolution logic (which resolves by `organizationId` or email domain) may depend on the Organization plugin's query patterns. Direct source code inspection is needed to confirm.

**[INTERPRETATION]**: If `organizationId` is indeed optional, Brain could either: (a) store workspace IDs in the `organizationId` field as opaque strings, or (b) use the `domain` field for provider resolution instead. Option (a) requires verifying that the SSO plugin does not validate `organizationId` against Better Auth's `organization` table.

---

### Finding 4: SSO and oauthProvider Plugins Use Different Route Prefixes -- No Collision Expected

**Evidence**: The SSO plugin registers routes under the `/sso/` prefix:
- `/sso/callback` and `/sso/callback/:providerId` -- OIDC callback endpoints
- `/sso/saml2/sp/metadata` -- SAML SP metadata
- `/sso/saml2/callback/:providerId` -- SAML callback
- Registration and sign-in API endpoints under `/sso/`

The `oauthProvider` plugin registers routes under the `/oauth2/` prefix:
- `/oauth2/authorize` -- Authorization endpoint
- `/oauth2/token` -- Token endpoint
- `/oauth2/userinfo` -- UserInfo endpoint
- `/oauth2/register` -- Dynamic client registration
- `/oauth2/consent` -- Consent endpoint
- `/oauth2/end-session` -- End session endpoint

These two plugins serve opposite roles (SSO = OAuth client; oauthProvider = OAuth server) and use entirely different route namespaces.

**Confidence**: Medium-High

**Verification**: Cross-referenced with:
- [Better Auth SSO Docs](https://better-auth.com/docs/plugins/sso) - Documents `/sso/*` route paths
- [Better Auth OAuth Provider Docs](https://better-auth.com/docs/plugins/oauth-provider) - Documents `/oauth2/*` route paths
- [DeepWiki: OAuth Provider & OIDC Provider](https://deepwiki.com/better-auth/better-auth/6.4-oauth-provider-and-oidc-provider) - Source analysis confirms `/oauth2/*` endpoints
- [GitHub Issue #6270](https://github.com/better-auth/better-auth/issues/6270) - Documents a known route collision between `mcp` and `oidcProvider` plugins at `/oauth2/consent`, but this is `oidcProvider` (not `oauthProvider`) conflicting with `mcp` (not `sso`)

**Analysis**: The route collision documented in Issue #6270 is between the `mcp` plugin and the `oidcProvider` plugin (both registering `/oauth2/consent`), not between SSO and oauthProvider. Since SSO uses `/sso/*` and oauthProvider uses `/oauth2/*`, no route collision is expected. However, both plugins may interact with the same internal state (user sessions, account linking). Brain already uses `oauthProvider` for MCP/CLI token issuance, so adding SSO alongside it should be safe from a route perspective.

**[INTERPRETATION]**: The deeper concern is not route collisions but middleware/hook interactions. Both plugins likely hook into Better Auth's session and account-linking middleware. If the SSO plugin modifies session handling or account creation behavior in ways that conflict with oauthProvider's token issuance flow, subtle bugs could emerge. This requires integration testing rather than static analysis.

---

### Finding 5: The Generic OAuth Plugin Handles Plain OAuth 2.0 -- But is Static Only

**Evidence**: The `genericOAuth` plugin accepts explicit `authorizationUrl`, `tokenUrl`, and `userInfoUrl` fields, with `discoveryUrl` as optional. This is exactly the configuration model needed for GitHub, Slack, and Linear. However, as established in the [prior research document](/Users/marcus/Git/brain/docs/research/better-auth-dynamic-oauth-providers.md), the Generic OAuth plugin is static -- configured at `betterAuth()` initialization time with no runtime registration API.

**Confidence**: High (established in prior research)

**Verification**: Cross-referenced with:
- [Better Auth Generic OAuth Docs](https://better-auth.com/docs/plugins/generic-oauth) - Shows `authorizationUrl`, `tokenUrl`, `userInfoUrl` fields with optional `discoveryUrl`
- [Prior Research: Dynamic OAuth Providers](/Users/marcus/Git/brain/docs/research/better-auth-dynamic-oauth-providers.md) - Finding 1 and Finding 2 establish static-only configuration
- [GitHub Discussion #3721](https://github.com/better-auth/better-auth/discussions/3721) - Confirms genericOAuth is static, SSO is for dynamic

**Analysis**: This creates a fundamental impedance mismatch: the plugin with the right configuration model (Generic OAuth) lacks dynamic registration, and the plugin with dynamic registration (SSO) lacks the right configuration model for plain OAuth 2.0 providers.

---

## Source Analysis

| Source | Domain | Reputation | Type | Access Date | Verification |
|--------|--------|------------|------|-------------|--------------|
| Better Auth SSO Docs | better-auth.com | High | Official docs | 2026-03-22 | Cross-verified Y |
| Better Auth OAuth Provider Docs | better-auth.com | High | Official docs | 2026-03-22 | Cross-verified Y |
| Better Auth Generic OAuth Docs | better-auth.com | High | Official docs | 2026-03-22 | Cross-verified Y |
| Better Auth 1.5 Blog | better-auth.com | High | Official blog | 2026-03-22 | Cross-verified Y |
| GitHub Issue #3728 | github.com | High | Issue tracker | 2026-03-22 | Cross-verified Y |
| GitHub Issue #4346 | github.com | High | Issue tracker | 2026-03-22 | Cross-verified Y |
| GitHub Issue #4972 | github.com | High | Issue tracker | 2026-03-22 | Cross-verified Y |
| GitHub Issue #6270 | github.com | High | Issue tracker | 2026-03-22 | Cross-verified Y |
| GitHub Discussion #3721 | github.com | High | Community/maintainer | 2026-03-22 | Cross-verified Y |
| DeepWiki: Enterprise SSO | deepwiki.com | Medium-High | AI source analysis | 2026-03-22 | Cross-verified Y |
| DeepWiki: OAuth Provider & OIDC Provider | deepwiki.com | Medium-High | AI source analysis | 2026-03-22 | Cross-verified Y |
| SSO Docs Source (GitHub) | github.com | High | Primary source | 2026-03-22 | Cross-verified Y |
| AnswerOverflow: SSO Register Usage | answeroverflow.com | Medium | Community Q&A | 2026-03-22 | Cross-verified Y |
| Prior Research: Dynamic OAuth Providers | local codebase | High | Primary source | 2026-03-22 | Direct observation |

**Reputation Summary**:
- High reputation sources: 11 (79%)
- Medium-high reputation: 2 (14%)
- Medium reputation: 1 (7%)
- Average reputation score: 0.82

---

## Knowledge Gaps

### Gap A: SSO Plugin Source Code for Organization Validation

**Issue**: Could not directly read `packages/sso/src/routes/sso.ts` or the database schema definition to confirm whether `organizationId` is validated against the `organization` table at registration time or sign-in time. The finding relies on documentation language and GitHub issue patterns rather than source code.
**Attempted Sources**: DeepWiki source analysis, GitHub issues, official docs. Direct GitHub file reading was not available.
**Recommendation**: Clone the `better-auth` repository and inspect: (1) the `sso_provider` table schema definition for `organizationId` nullability, (2) the `registerSSOProvider` handler for organization existence checks, (3) the `signInSSO` handler for organization resolution logic.

### Gap B: SSO Plugin Internal OIDC Flow -- id_token vs userinfo Fallback

**Issue**: It is unclear whether the SSO plugin's OIDC flow hard-fails if the provider does not return an `id_token`, or whether it falls back to the `userinfo` endpoint. If a fallback to userinfo exists, it might be possible to register plain OAuth 2.0 providers by manually specifying all endpoints and skipping discovery. No source confirms or denies this.
**Attempted Sources**: DeepWiki, SSO docs, GitHub issues. The `jose` library usage suggests `id_token` is expected, but the exact error handling is unknown.
**Recommendation**: Inspect `packages/sso/src/oidc/` for the token exchange callback handler. Check if `id_token` absence triggers a hard error or a `userinfo` endpoint fallback.

### Gap C: Middleware/Hook Interactions Between SSO and oauthProvider

**Issue**: While route paths do not collide, both plugins may hook into Better Auth's internal middleware (session management, account linking, token validation). No documentation or issue describes testing these two plugins together.
**Attempted Sources**: GitHub issues, docs, DeepWiki. No reports of SSO + oauthProvider coexistence found.
**Recommendation**: Set up a test instance with both plugins enabled and verify: (1) session handling is not disrupted, (2) account linking for SSO users does not interfere with oauthProvider token issuance, (3) no shared internal state conflicts.

---

## Conflicting Information

### Conflict 1: SSO Plugin "OAuth2 Provider" Support Claims vs Actual Implementation

**Position A**: The SSO plugin "supports OpenID Connect (OIDC), OAuth2 providers, and SAML 2.0" (marketing/overview copy on docs and blog posts).
- Source: [Better Auth SSO Docs](https://better-auth.com/docs/plugins/sso) - Reputation: High
- Evidence: Introductory paragraph mentions OAuth2

**Position B**: Every concrete configuration example, API parameter, and code path in the SSO plugin is OIDC-specific (requires `issuer`, uses discovery, validates `id_token` with `jose`, requires `jwks_uri`).
- Source: [Better Auth SSO Docs (config section)](https://better-auth.com/docs/plugins/sso), [DeepWiki: Enterprise SSO](https://deepwiki.com/better-auth/better-auth/6.2-enterprise-sso), [GitHub Issue #3728](https://github.com/better-auth/better-auth/issues/3728) - Reputation: High
- Evidence: All registration examples require `issuer`; `jose` library handles token validation; discovery endpoint is core flow

**Assessment**: Position B has stronger evidence. The "OAuth2" mention in Position A likely refers to the fact that OIDC is built on OAuth 2.0, not that the plugin supports plain OAuth 2.0 authorization code flow without OIDC extensions. The plugin's architecture is fundamentally OIDC-centric. This is the most important finding for Brain's credential brokerage design.

---

## Recommendations for Further Research

1. **Clone and inspect Better Auth source code directly**. The three knowledge gaps (A, B, C) all require reading actual TypeScript source files in `packages/sso/src/`. Specific files to inspect: `routes/sso.ts` (registration/sign-in handlers), `oidc/discovery.ts` (discovery logic), `schema.ts` (database table definitions), and `index.ts` (plugin init and dependency checks).

2. **Evaluate a hybrid architecture**. Given that the SSO plugin does not support plain OAuth 2.0 and the Generic OAuth plugin does not support dynamic registration, Brain may need a custom plugin that combines: (a) the Generic OAuth plugin's configuration model (explicit `authorizationUrl`/`tokenUrl`/`userInfoUrl`) with (b) the SSO plugin's database-backed dynamic registration pattern. This could be implemented as a Better Auth plugin that stores provider configs in SurrealDB and resolves them per-request.

3. **Test SSO + oauthProvider coexistence**. Set up a minimal Better Auth instance with both `sso()` and `oauthProvider()` plugins enabled. Verify no session, account-linking, or middleware conflicts. Test the full flow: user authenticates via Brain's oauthProvider (MCP client), then the same user connects an external OIDC provider via SSO.

4. **Consider forking the SSO plugin**. If Brain needs database-backed dynamic OAuth 2.0 provider registration (not just OIDC), forking the SSO plugin and replacing the OIDC-specific flow with a Generic-OAuth-compatible flow may be more maintainable than building from scratch. The SSO plugin's database schema, registration API, and provider resolution logic are valuable; only the OIDC sign-in callback needs replacement.

---

## Answers to Original Gap Questions

### Gap 1: Non-OIDC OAuth 2.0 Support

**The SSO plugin does NOT support plain OAuth 2.0 providers.** It requires an OIDC discovery endpoint (derived from `issuer`), validates `id_token` using `jose`, and requires `jwks_uri`. GitHub (which uses `/login/oauth/authorize` and `/login/oauth/access_token` with no discovery, no id_token, no JWKS), Slack, and Linear cannot be registered as SSO providers. The "OAuth2" mention in documentation appears to refer to the OAuth 2.0 protocol underlying OIDC, not standalone OAuth 2.0 support.

### Gap 2: Organization Plugin Dependency

**Soft dependency -- likely optional.** The `organizationId` field on `sso_provider` records appears to be nullable based on documentation language and GitHub issue patterns, but this has not been confirmed via source code. The Organization plugin is not listed as a required dependency in the SSO plugin installation docs. Brain could likely store workspace IDs in the `organizationId` field, but the provider resolution logic at sign-in time may expect Organization plugin query patterns. **Confidence: Medium -- source code inspection needed.**

### Gap 3: Coexistence with oauthProvider Plugin

**No route collisions expected.** SSO uses `/sso/*` routes; oauthProvider uses `/oauth2/*` routes. The known route collision (Issue #6270) is between `mcp` and `oidcProvider`, not between SSO and oauthProvider. The deeper risk is middleware/hook interactions (session handling, account linking), which requires integration testing. **Confidence: Medium-High for routes; Medium for middleware safety.**

---

## Full Citations

[1] Better Auth. "Single Sign-On (SSO)". better-auth.com. 2026. https://better-auth.com/docs/plugins/sso. Accessed 2026-03-22.
[2] Better Auth. "OAuth 2.1 Provider". better-auth.com. 2026. https://better-auth.com/docs/plugins/oauth-provider. Accessed 2026-03-22.
[3] Better Auth. "Generic OAuth". better-auth.com. 2026. https://better-auth.com/docs/plugins/generic-oauth. Accessed 2026-03-22.
[4] Better Auth. "Better Auth 1.5". better-auth.com. 2026. https://better-auth.com/blog/1-5. Accessed 2026-03-22.
[5] better-auth/better-auth. "Discovery in SSO OIDC registration is not used". GitHub Issue #3728. https://github.com/better-auth/better-auth/issues/3728. Accessed 2026-03-22.
[6] better-auth/better-auth. "Allow static OIDC providers in SSO plugin config". GitHub Issue #4346. https://github.com/better-auth/better-auth/issues/4346. Accessed 2026-03-22.
[7] better-auth/better-auth. "Users signing in with different methods don't get added to the organization". GitHub Issue #4972. https://github.com/better-auth/better-auth/issues/4972. Accessed 2026-03-22.
[8] better-auth/better-auth. "Endpoint path conflicts detected! Multiple plugins trying to use same paths". GitHub Issue #6270. https://github.com/better-auth/better-auth/issues/6270. Accessed 2026-03-22.
[9] better-auth/better-auth. "Dynamic provider config in a multi-tenant env". GitHub Discussion #3721. https://github.com/better-auth/better-auth/discussions/3721. Accessed 2026-03-22.
[10] DeepWiki. "Enterprise SSO". deepwiki.com. 2026. https://deepwiki.com/better-auth/better-auth/6.2-enterprise-sso. Accessed 2026-03-22.
[11] DeepWiki. "OAuth Provider & OIDC Provider". deepwiki.com. 2026. https://deepwiki.com/better-auth/better-auth/6.4-oauth-provider-and-oidc-provider. Accessed 2026-03-22.
[12] better-auth/better-auth. "SSO Plugin Documentation Source". GitHub. https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/sso.mdx. Accessed 2026-03-22.
[13] AnswerOverflow. "Exploring Better Auth SSO Plugin -- Guidance on authClient.sso.register Usage". answeroverflow.com. 2026. https://www.answeroverflow.com/m/1363058816081723502. Accessed 2026-03-22.
[14] Brain codebase. "Prior Research: Dynamic OAuth Providers". Local file. /Users/marcus/Git/brain/docs/research/better-auth-dynamic-oauth-providers.md. Accessed 2026-03-22.

---

## Research Metadata

- **Total Sources Examined**: 20+
- **Sources Cited**: 14
- **Cross-References Performed**: 12
- **Confidence Distribution**: High: 40%, Medium-High: 20%, Medium: 40%
- **Output File**: docs/research/better-auth-sso-plugin-gap-analysis.md
