# Journey: Tool Registry UI

## Actors

### Actor 1: Workspace Admin (Priya Sharma)
Role: DevOps lead managing a 6-person engineering team. Responsible for setting up integrations (GitHub, Slack, Linear) and governing which agents can use which tools.

### Actor 2: Workspace Member (Carlos Mendez)
Role: Senior developer who uses Brain-connected coding agents daily. Wants agents to create GitHub issues and query Linear on his behalf.

---

## Admin Journey: Provider Setup to Tool Governance

```
[Navigate to         [Register          [Browse           [Grant Tool        [Attach
 Tool Registry] -->   Provider] -->      Tools] -->        Access] -->        Governance]

 Feels: Oriented     Feels: Guided      Feels: Informed   Feels: In control  Feels: Confident
 Sees: Sidebar nav   Sees: Adaptive     Sees: Grouped     Sees: Identity     Sees: Policy
       + empty state        form              tool list          picker +           attachment
                                                                  rate limits        confirmation
```

### Step 1: Navigate to Tool Registry
```
+-- Brain -- Workspace: Acme Engineering --------------------------+
|                                                                   |
|  [Sidebar]              [Main Content]                           |
|  ----------              --------------------------------------- |
|  Chat                    Tool Registry                           |
|  Graph                                                           |
|  Learnings               No tools registered yet.                |
|  Policies                                                        |
|  > Tool Registry         Register a credential provider to       |
|                          start connecting integrations.           |
|                                                                   |
|                          [ + Add Provider ]                      |
|                                                                   |
+-------------------------------------------------------------------+
```
Emotion: Oriented -> Curious (empty state guides next action)

### Step 2: Register Credential Provider
```
+-- Add Provider (Dialog) -----------------------------------------+
|                                                                   |
|  Provider Name:     [ github                              ]      |
|  Display Name:      [ GitHub                              ]      |
|  Auth Method:       [ OAuth2            v ]                      |
|                                                                   |
|  -- OAuth2 Settings --                                           |
|  Authorization URL: [ https://github.com/login/oauth/auth ]     |
|  Token URL:         [ https://github.com/login/oauth/tok  ]     |
|  Client ID:         [ Ov23liABC123...                     ]      |
|  Client Secret:     [ *********************************** ]      |
|  Scopes:            [ repo,read:org                       ]      |
|                                                                   |
|                              [ Cancel ]  [ Create Provider ]     |
+-------------------------------------------------------------------+
```

```
+-- Add Provider (Dialog) -- auth_method = api_key ----------------+
|                                                                   |
|  Provider Name:     [ internal-api                        ]      |
|  Display Name:      [ Internal API                        ]      |
|  Auth Method:       [ API Key           v ]                      |
|                                                                   |
|  (No additional fields required for API key providers.)          |
|                                                                   |
|                              [ Cancel ]  [ Create Provider ]     |
+-------------------------------------------------------------------+
```
Emotion: Guided -> Confident (form adapts to auth method, no guesswork)

### Step 3: Browse Tools
```
+-- Tool Registry -- Tools ----------------------------------------+
|                                                                   |
|  [Tools]  [Providers]  [Accounts]  [Access]                      |
|                                                                   |
|  Filter: [All statuses v] [All risk levels v]  [Search...]      |
|                                                                   |
|  github (4 tools)                                    [Expand v]  |
|  +---------------------------------------------------------------+
|  | Name                  | Risk   | Status | Grants | Provider  |
|  |-----------------------|--------|--------|--------|-----------|
|  | github.create_issue   | medium | active |      3 | github    |
|  | github.list_reviews   | low    | active |      2 | github    |
|  | github.merge_pr       | high   | active |      1 | github    |
|  | github.comment_pr     | medium | active |      3 | github    |
|  +---------------------------------------------------------------+
|                                                                   |
|  slack (2 tools)                                     [Expand v]  |
|  +---------------------------------------------------------------+
|  | Name                  | Risk   | Status | Grants | Provider  |
|  |-----------------------|--------|--------|--------|-----------|
|  | slack.post_message    | medium | active |      4 | slack     |
|  | slack.list_channels   | low    | active |      2 | slack     |
|  +---------------------------------------------------------------+
|                                                                   |
+-------------------------------------------------------------------+
```
Emotion: Informed -> Oriented (clear grouping, filterable, grant counts visible)

### Step 4: Grant Tool Access
```
+-- Tool Access -- github.create_issue ----------------------------+
|                                                                   |
|  Grant Access                                                    |
|                                                                   |
|  Identity:          [ coding-agent-1         v ]                 |
|  Rate Limit:        [ 20     ] calls/hour  (optional)           |
|                                                                   |
|                              [ Cancel ]  [ Grant Access ]        |
+-------------------------------------------------------------------+
|                                                                   |
|  Current Grants:                                                 |
|  +---------------------------------------------------------------+
|  | Identity         | Source   | Rate Limit    | Granted        |
|  |------------------|----------|---------------|----------------|
|  | coding-agent-1   | direct   | 20/hr         | 2026-03-23     |
|  | review-agent     | direct   | unlimited     | 2026-03-22     |
|  | design-agent     | skill:   | unlimited     | 2026-03-21     |
|  |                  | code-rev |               |                |
|  +---------------------------------------------------------------+
|                                                                   |
+-------------------------------------------------------------------+
```
Emotion: In control -> Confident (clear who has access to what)

### Step 5: Attach Governance
```
+-- Attach Policy (Dialog) ----------------------------------------+
|                                                                   |
|  Tool:              github.merge_pr                              |
|  Policy:            [ no-auto-merge          v ]                 |
|  Condition:         [ requires_human_approval ]                  |
|  Max Calls/Day:     [ 5                       ] (optional)      |
|                                                                   |
|                              [ Cancel ]  [ Attach Policy ]       |
+-------------------------------------------------------------------+
```
Emotion: Confident -> Secure (high-risk tools governed before use)

---

## Member Journey: Connect Account and Manage

```
[Browse             [Connect           [View              [Revoke
 Providers] -->      Account] -->       Connected] -->     Account]
                                        Accounts

 Feels: Curious     Feels: Familiar    Feels: Informed    Feels: In control
 Sees: Provider     Sees: OAuth or     Sees: Dashboard    Sees: Confirmation
       list               static form         with status        dialog
```

### Step 1: Browse Available Providers
```
+-- Tool Registry -- Providers ------------------------------------+
|                                                                   |
|  [Tools]  [Providers]  [Accounts]  [Access]                      |
|                                                                   |
|  Available Providers                                             |
|  +---------------------------------------------------------------+
|  | Provider    | Auth Method | Status       | Action             |
|  |-------------|-------------|--------------|-------------------|
|  | GitHub      | OAuth2      | Connected    | Reconnect         |
|  | Slack       | OAuth2      | Not connected| [ Connect ]       |
|  | Internal API| API Key     | Not connected| [ Connect ]       |
|  | Legacy Svc  | Basic       | Expired      | [ Reconnect ]     |
|  +---------------------------------------------------------------+
|                                                                   |
+-------------------------------------------------------------------+
```
Emotion: Curious -> Oriented (clear status per provider)

### Step 2a: Connect Account (OAuth2)
```
+-- Connect to Slack ----------------------------------------------+
|                                                                   |
|  You will be redirected to Slack to authorize Brain.             |
|                                                                   |
|  Requested scopes:                                               |
|    - channels:read                                               |
|    - chat:write                                                  |
|                                                                   |
|  Brain will store tokens securely and use them only for          |
|  authorized tool calls. You can revoke access anytime.           |
|                                                                   |
|                     [ Cancel ]  [ Continue to Slack ]            |
+-------------------------------------------------------------------+

--> Browser redirects to Slack OAuth consent screen
--> On approval, redirects back with status "active"
```

### Step 2b: Connect Account (Static Credential)
```
+-- Connect to Internal API ---------------------------------------+
|                                                                   |
|  Enter your API key for Internal API.                            |
|  Your key will be encrypted and stored securely.                 |
|                                                                   |
|  API Key:  [ *************************************** ]           |
|                                                                   |
|  Brain will use this key only for authorized tool calls.         |
|  You can revoke access anytime.                                  |
|                                                                   |
|                     [ Cancel ]  [ Connect ]                      |
+-------------------------------------------------------------------+
```
Emotion: Familiar -> Relieved (trusted OAuth flow or simple form)

### Step 3: Connected Accounts Dashboard
```
+-- Tool Registry -- Accounts -------------------------------------+
|                                                                   |
|  [Tools]  [Providers]  [Accounts]  [Access]                      |
|                                                                   |
|  Your Connected Accounts                                         |
|  +---------------------------------------------------------------+
|  | Provider     | Status  | Connected     | Action               |
|  |--------------|---------|---------------|---------------------|
|  | GitHub       | active  | 2026-03-20    | [ Revoke ]          |
|  | Slack        | active  | 2026-03-23    | [ Revoke ]          |
|  | Internal API | active  | 2026-03-22    | [ Revoke ]          |
|  | Legacy Svc   | expired | 2026-03-15    | [ Reconnect ]       |
|  +---------------------------------------------------------------+
|                                                                   |
+-------------------------------------------------------------------+
```
Emotion: Informed -> In control (complete visibility, clear actions)

### Step 4: Revoke Account
```
+-- Revoke Connection ---------------------------------------------+
|                                                                   |
|  Disconnect GitHub?                                              |
|                                                                   |
|  This will permanently delete your stored credentials.           |
|  Agents will no longer be able to use GitHub tools on            |
|  your behalf.                                                    |
|                                                                   |
|  You can reconnect anytime.                                      |
|                                                                   |
|                     [ Cancel ]  [ Revoke Access ]                |
+-------------------------------------------------------------------+
```
Emotion: In control -> Relieved (clear consequences, reversible by reconnecting)

---

## Emotional Arc Summary

### Admin Arc: Confidence Building
```
Curious ------> Guided ------> Informed ------> Confident ------> Secure
(empty state)   (adaptive     (tool overview)   (access grants)   (governance
                 form)                                              attached)
```

### Member Arc: Trust Building
```
Curious ------> Familiar ------> Relieved ------> Informed ------> In Control
(browse         (OAuth/form)     (connected)      (dashboard)      (revoke
 providers)                                                          option)
```

No jarring emotional transitions. Confidence builds progressively through small wins at each step.
