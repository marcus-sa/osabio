# Walking Skeleton Rationale -- Tool Registry UI

## Skeleton Definition

The walking skeleton proves: **Can workspace users manage integrations and see their tools, providers, accounts, and grants through the API endpoints?**

## Thinnest E2E Slice

```
Admin registers provider (POST /providers)
  -> Provider appears in list (GET /providers)
Member connects account (POST /accounts/connect/:id)
  -> Account appears in dashboard (GET /accounts)
Admin seeds tools (DB precondition)
  -> Tools browsable with grouping (GET /tools)
Admin grants access (POST /tools/:id/grants)
  -> Grant visible in tool detail (GET /tools/:id)
```

## Why These Four Skeletons

1. **Provider registration + listing**: Proves the Providers tab has data. Entry point for all subsequent integration management.
2. **Account connection + listing**: Proves the Accounts tab works. Validates credential encryption pipeline end-to-end.
3. **Tool browsing with grouping**: Proves the Tools tab renders meaningful data. Validates the NEW GET /tools endpoint with counts.
4. **Grant creation + detail**: Proves the Access tab works. Validates the NEW grant management endpoints.

## Litmus Test

| Question | Answer |
|----------|--------|
| Title describes user goal? | "Admin manages integrations end-to-end" -- yes |
| Given/When describe user actions? | "Admin registers provider", "Member connects account" -- yes |
| Then describe user observations? | "Provider appears in list", "Account shows active status" -- yes |
| Non-technical stakeholder confirms? | "Yes, I can see my providers, connect accounts, browse tools, and manage access" |

## What Is NOT in the Skeleton

- OAuth2 browser redirect (cannot test in acceptance suite)
- MCP Server Discovery (deferred per wave decision)
- Governance policy attachment (Release 2 scope)
- UI-specific behavior (keyboard navigation, empty states, badges)

## Implementation Sequence

Enable skeletons in order (each builds on previous):
1. Skeleton 1: Provider CRUD (exercises existing endpoint)
2. Skeleton 2: Account connection (exercises existing endpoint with DPoP auth)
3. Skeleton 3: Tool browsing (requires NEW GET /tools endpoint)
4. Skeleton 4: Grant management (requires NEW grant endpoints)
