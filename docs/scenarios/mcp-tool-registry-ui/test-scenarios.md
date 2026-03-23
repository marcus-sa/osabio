# Test Scenarios -- Tool Registry UI

## Scenario Inventory

Total: 97 scenarios
- Walking skeletons: 6 (6%)
- Happy path: 34 (35%)
- Error path: 43 (44%)
- Security: 6 (6%)
- Boundary/edge: 8 (8%)

Error path ratio: 44% (target: >= 40%) -- PASS

## Story Coverage Map

### US-UI-01: Page Shell and Navigation
| AC | Scenario | File |
|----|----------|------|
| AC-01d | Empty provider list returned | milestone-1, "returns empty list when no providers exist" |
| AC-01d | Empty tool list returned | milestone-3, "returns empty list when no tools exist" |
| AC-01d | Empty account list returned | milestone-5, "returns empty list when member has no connected accounts" |
| AC-01d | Empty server list returned | milestone-10, "returns empty server list" |

Note: Route registration (AC-01a), sidebar (AC-01b), tab rendering (AC-01c), keyboard nav (AC-01e) are UI-only concerns tested at component level, not HTTP acceptance level.

### US-UI-02: Browse Tools
| AC | Scenario | File |
|----|----------|------|
| AC-02a | Tools grouped by toolkit with counts | walking-skeleton #3, milestone-3 "grouped by toolkit" |
| AC-02b | Tool row has all display fields | milestone-3 "complete data shape for UI rendering" |
| AC-02a | Grant count per tool | milestone-3 "includes grant count per tool" |
| AC-02a | Governance count per tool | milestone-3 "includes governance count per tool" |
| AC-02f | Empty tool list | milestone-3 "returns empty list when no tools exist" |

Note: Client-side filters (AC-02c/d/e) and color badges (AC-02g) are UI-only.

### US-UI-03: Register Credential Provider
| AC | Scenario | File |
|----|----------|------|
| AC-03b | OAuth2 provider with all fields | milestone-1 "OAuth2 provider with all OAuth-specific fields" |
| AC-03c | API key provider with base fields | milestone-1 "API key provider with only base fields" |
| AC-03c | Bearer token provider | milestone-1 "bearer token provider" |
| AC-03c | Basic auth provider | milestone-1 "basic auth provider" |
| AC-03e | Duplicate name rejection | milestone-1 "rejects duplicate provider name" |
| AC-03f | Provider appears in list after creation | walking-skeleton #1 |
| AC-03g | Missing name rejected | milestone-1 "rejects missing required name field" |
| AC-03g | Missing display_name rejected | milestone-1 "rejects missing required display_name" |
| AC-03g | Invalid auth_method rejected | milestone-1 "rejects invalid auth_method" |
| AC-03g | Malformed JSON rejected | milestone-1 "rejects malformed JSON body" |
| AC-03d | Client secret never in response | milestone-1 "client_secret is not returned" (x2) |

### US-UI-04: Connect Account (Static)
| AC | Scenario | File |
|----|----------|------|
| AC-04a | API key connection | milestone-2 "connects account with API key" |
| AC-04b | Basic auth connection | milestone-2 "connects account with basic auth" |
| AC-04c | Bearer token connection | milestone-2 "connects account with bearer token" |
| AC-04e | Empty API key rejected | milestone-2 "rejects empty API key" |
| AC-04e | Empty basic auth rejected | milestone-2 "rejects empty basic auth" |
| AC-04e | Empty bearer rejected | milestone-2 "rejects empty bearer token" |
| AC-04f | Account appears active | walking-skeleton #2 |
| | Nonexistent provider rejected | milestone-2 "rejects connection to nonexistent provider" |
| | Duplicate connection rejected | milestone-2 "rejects duplicate connection" |
| | API key not in response | milestone-2 "API key is not returned" |
| | Credentials not in list response | milestone-2 "credentials are not returned in account list" |

### US-UI-05: Grant Tool Access
| AC | Scenario | File |
|----|----------|------|
| AC-05b | Grant with rate limit | milestone-4 "grants access with rate limit" |
| AC-05b | Grant without rate limit | milestone-4 "grants access without rate limit" |
| AC-05c | Grant count updates | milestone-4 "grant_count updates after new grants" |
| AC-05d | Duplicate grant rejected | milestone-4 "rejects duplicate grant" |
| AC-05e | Grant list with details | milestone-4 "sees grant in list" |
| | Multiple identities granted | milestone-4 "multiple identities can be granted" |
| | Nonexistent identity rejected | milestone-4 "rejects grant to nonexistent identity" |
| | Nonexistent tool rejected | milestone-4 "rejects grant to nonexistent tool" |
| | Missing identity_id rejected | milestone-4 "rejects grant without identity_id" |

### US-UI-06: OAuth2 Flow
| AC | Scenario | File |
|----|----------|------|
| AC-06a/b | Redirect URL returned | milestone-2 "returns redirect URL with state parameter" |

Note: Full OAuth2 browser redirect (AC-06c/d/e) cannot be tested in acceptance suite. Tested at integration level with mock IdP.

### US-UI-07: Connected Accounts Dashboard
| AC | Scenario | File |
|----|----------|------|
| AC-07a | Mixed-status account list | milestone-5 "lists accounts with mixed statuses" |
| AC-07e/f | Revoke active account | milestone-5 "revokes active account" |
| AC-07e | Credentials deleted on revoke | milestone-5 "permanently deletes encrypted credentials" |
| AC-07g | Empty accounts state | milestone-5 "returns empty list" |
| AC-07h | Reconnect after revocation | milestone-5 "reconnect after revocation" |
| | Identity isolation | milestone-5 "only returns accounts for authenticated identity" |
| | Nonexistent account revoke | milestone-5 "returns 404 when revoking nonexistent" |
| | Idempotent revocation | milestone-5 "revocation is idempotent" |

### US-UI-08: Tool Governance
| AC | Scenario | File |
|----|----------|------|
| AC-08d | Attach policy with condition + limits | milestone-6 "attaches policy with condition" |
| AC-08d | Attach rate-limit-only policy | milestone-6 "attaches policy with rate limit only" |
| AC-08a | Governance indicator (count > 0) | milestone-6 "governance_count" |
| AC-08e | Governance details in tool detail | milestone-6 "attaches policy" (detail verification) |
| AC-08b | Only active policies allowed | milestone-6 "rejects attachment of deprecated policy" |
| | Multiple policies on same tool | milestone-6 "multiple policies can be attached" |
| | Nonexistent policy rejected | milestone-6 "rejects attachment of nonexistent policy" |
| | Nonexistent tool rejected | milestone-6 "rejects attachment to nonexistent tool" |
| | Missing policy_id rejected | milestone-6 "rejects attachment without policy_id" |

### US-UI-09: MCP Server Connection
| AC | Scenario | File |
|----|----------|------|
| AC-09a/b | Register unauthenticated server | milestone-7 "registers an unauthenticated MCP server" |
| AC-09b | Register with SSE transport | milestone-7 "registers an MCP server with SSE transport" |
| AC-09b | Register authenticated server with provider | milestone-7 "registers an authenticated MCP server" |
| AC-09b | Default transport is streamable-http | milestone-7 "defaults transport to streamable-http" |
| AC-09e | Server appears in list | milestone-7 "lists all MCP servers" |
| AC-09e | Server detail with capabilities | milestone-7 "returns server detail" |
| AC-09c | Non-http URL rejected | milestone-7 "rejects non-http URL scheme" |
| AC-09c | javascript: URL rejected | milestone-7 "rejects javascript: URL scheme" |
| AC-09d | Duplicate name rejected | milestone-7 "rejects duplicate server name" |
| | Missing name rejected | milestone-7 "rejects missing server name" |
| | Missing URL rejected | milestone-7 "rejects missing URL" |
| | Invalid transport rejected | milestone-7 "rejects invalid transport value" |
| | Nonexistent provider rejected | milestone-7 "rejects link to nonexistent credential provider" |
| | Server removal confirmation | milestone-7 "removes server and returns confirmation" |
| AC-12e | Removal disables discovered tools | milestone-7 "disables discovered tools when server is removed" |
| | Nonexistent server removal 404 | milestone-7 "returns 404 when removing nonexistent server" |
| | Workspace isolation | milestone-7 "only returns servers belonging to the requested workspace" |

Note: Transport auto-detect (AC-09g) requires mock MCP server returning 4xx. Tested with InMemoryTransport during DELIVER.

### US-UI-10: Tool Discovery and Import
| AC | Scenario | File |
|----|----------|------|
| AC-10a/b | Dry-run discovery returns tools | milestone-8 "dry-run discovery returns tools" |
| AC-10g | Full sync creates tool records | milestone-8 "full sync creates mcp_tool records" |
| AC-10c | Selective import | milestone-8 "imports only selected tools" |
| AC-10h | Re-sync detects new tools | milestone-8 "re-sync detects new tools" |
| | Re-sync detects removed tools | milestone-8 "re-sync detects removed tools" |
| AC-10g | Sync updates server tool_count | milestone-8 "sync updates server tool_count" |
| AC-10e | Risk level inferred from annotations | milestone-8 "read-only tool inferred as low risk" |
| AC-10f | Admin overrides risk level | deferred to DELIVER (requires interactive review panel) |
| | Unreachable server during discovery | milestone-8 "returns error when server is unreachable" |
| | Discovery on nonexistent server | milestone-8 "returns 404 for discovery on nonexistent server" |
| | Sync on nonexistent server | milestone-8 "returns 404 for sync on nonexistent server" |
| | Dry-run does not modify DB | milestone-8 "dry-run does not modify database state" |

### US-UI-11: Tool Execution via Proxy
| AC | Scenario | File |
|----|----------|------|
| AC-11a/b/e | Single tool call execution | walking-skeleton #6, milestone-9 "executes a single integration tool call" |
| AC-11c | API key credential injection | milestone-9 "injects API key credential" |
| AC-11c | Bearer token credential injection | milestone-9 "injects bearer token credential" |
| AC-11f | Multi-turn loop completes | milestone-9 "completes multi-turn loop" |
| AC-11f | Max iteration safety limit | milestone-9 "stops after maximum 10 iterations" |
| AC-11g | Unreachable server error | milestone-9 "returns error tool_result when upstream MCP server is unreachable" |
| AC-11g | MCP server error forwarded | milestone-9 "returns error tool_result when MCP server returns an error" |
| | No can_use grant rejects tool | milestone-9 "rejects tool call when agent lacks can_use grant" |
| | No source_server error | milestone-9 "returns error tool_result when tool has no source_server" |
| | Governance blocks execution | milestone-9 "blocks tool execution when governance policy rejects" |
| AC-11h | Connection reuse within request | milestone-9 "reuses connection for multiple tool calls to same server" |

Note: OAuth2 token refresh (AC-11d) is tested at unit level. Full proxy round-trip tests require mock Anthropic API + mock MCP server injected via ServerDependencies.

### US-UI-12: MCP Server Management
| AC | Scenario | File |
|----|----------|------|
| AC-12a/b | Server dashboard with status data | milestone-10 "lists servers with status indicators" |
| AC-12b | Server detail includes transport | milestone-10 "server detail includes transport" |
| AC-12d | Re-sync triggers discovery flow | milestone-10 "re-sync triggers discovery review flow" |
| AC-12e | Removal disables all discovered tools | milestone-10 "removal disables all discovered tools" |
| | Removal does not affect other servers | milestone-10 "removal does not affect tools from other servers" |
| AC-12f | Empty server list | milestone-10 "returns empty server list" |
| | 404 for nonexistent server detail | milestone-10 "returns 404 when viewing detail of nonexistent server" |
| | 404 for nonexistent server removal | milestone-10 "returns 404 when removing nonexistent server" |
| | Workspace isolation | milestone-10 "only returns servers belonging to the requesting workspace" |

## Implementation Sequence

1. Walking skeleton (all 6 scenarios enabled -- includes tool execution)
2. Milestone 1: Provider CRUD (11 scenarios)
3. Milestone 2: Account Connection (11 scenarios)
4. Milestone 3: Tool Browsing (9 scenarios)
5. Milestone 4: Access Grants (9 scenarios)
6. Milestone 5: Account Dashboard (8 scenarios)
7. Milestone 6: Tool Governance (9 scenarios)
8. Milestone 7: MCP Server Connection (17 scenarios)
9. Milestone 8: Tool Discovery (12 scenarios)
10. Milestone 9: Tool Execution (11 scenarios)
11. Milestone 10: Server Management (9 scenarios)

Note: Milestones 7-10 correspond to the new stories US-UI-09 through US-UI-12. They are numbered 7-10 to continue the existing sequence without renaming milestones 4-6 which already exist.
