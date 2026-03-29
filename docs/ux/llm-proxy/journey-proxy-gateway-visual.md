# Journey: LLM Proxy Gateway -- Visual Map

**Epic**: llm-proxy
**Personas**: Marcus (Admin), Priya (Developer), Observer Agent, Elena (Auditor)
**Goal**: Every LLM call made by any agent flows through Osabio's proxy, producing cost attribution, policy enforcement, and graph-native traces -- all transparently.

---

## Journey Flow

```
                    SETUP PHASE                              RUNTIME PHASE                           REVIEW PHASE
               (once per workspace)                    (every LLM call, transparent)              (on-demand, async)

  [1. Configure]  -->  [2. Connect]  -->  [3. Authenticate]  -->  [4. Authorize]  -->  [5. Forward]  -->  [6. Capture]  -->  [7. Monitor]  -->  [8. Audit]
       |                    |                    |                      |                    |                 |                  |                  |
   Admin sets up       Developer sets       Proxy identifies      Proxy checks          Proxy relays      Proxy extracts    Admin reviews     Auditor traces
   proxy config +      ANTHROPIC_BASE_URL   who is calling        policies/budget       request to        usage, computes   spend dashboard   provenance
   policies            via osabio init       from headers          before forwarding     Anthropic API     cost, writes      and anomalies     chain
       |                    |                    |                      |                    |              graph trace           |                  |
   Emotional:          Emotional:           Emotional:             Emotional:           Emotional:        Emotional:         Emotional:        Emotional:
   FOCUSED             EXPECTANT            INVISIBLE              PROTECTED            UNAWARE           INVISIBLE          INFORMED          ASSURED
   "Setting up         "Will this           (should not            "My policies         "Just using       (should not        "I see exactly    "Every call
    governance"         just work?"          be noticed)            are enforced"        Claude Code"      be noticed)        where $ goes"     is traceable"
```

---

## Emotional Arc

```
Confidence
    ^
    |
    |                                                                                    ****  [7. INFORMED]
    |                                                                                ***    **
    |                                                                             ***        **** [8. ASSURED]
    |     [1. FOCUSED]                                                         ***
    |    **            [2. EXPECTANT]                                        ***
    |  **                **                                               ***
    | *                    *      [3-6. TRANSPARENT / INVISIBLE]        **
    |*                      *************************************** ***
    |
    +-------------------------------------------------------------------------> Time
         Setup                    Runtime (per-call)                   Review
```

**Arc pattern**: Confidence Building
- Start: Focused/Expectant during setup (admin is deliberately configuring governance)
- Middle: Transparent/Invisible during runtime (proxy should never be noticed)
- End: Informed/Assured during review (admin/auditor sees full picture)

**Key design principle**: The proxy's best UX is NO UX during runtime. The user experience surfaces only at the boundaries -- setup and review.

---

## Step Details

### Step 1: Configure Proxy + Policies (Admin)

```
+-- Step 1: Configure Proxy ----------------------------------------+
|                                                                    |
|  Osabio Dashboard > Settings > LLM Proxy                           |
|                                                                    |
|  Proxy Status: [ACTIVE]  Port: ${PROXY_PORT}                     |
|                                                                    |
|  Budget Limits:                                                    |
|  +---------------------------------------------+                  |
|  | Scope       | Daily   | Monthly | Alert At  |                  |
|  |-------------|---------|---------|-----------|                  |
|  | Workspace   | $50.00  | $500.00 | 80%       |                  |
|  | Project: X  | $20.00  | --      | 90%       |                  |
|  +---------------------------------------------+                  |
|                                                                    |
|  Model Access Policies:                                            |
|  +---------------------------------------------+                  |
|  | Agent Type      | Allowed Models            |                  |
|  |-----------------|---------------------------|                  |
|  | coding-agent    | sonnet-4, haiku-3.5       |                  |
|  | observer        | haiku-3.5                 |                  |
|  | pm-agent        | haiku-3.5                 |                  |
|  +---------------------------------------------+                  |
|                                                                    |
|  [Save Configuration]                                              |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${PROXY_PORT}`, `${PROXY_URL}`, budget thresholds, model access policies
**Emotional state**: Entry: Cautious ("setting up governance correctly") | Exit: Confident ("policies are configured")
**Integration checkpoint**: Proxy configuration persisted to workspace settings; policies written to policy graph

---

### Step 2: Connect Agent (Developer)

```
+-- Step 2: Connect Agent -------------------------------------------+
|                                                                    |
|  $ osabio init                                                      |
|                                                                    |
|  Osabio Workspace: marcus/osabio-v1                                  |
|  LLM Proxy: Detected at ${PROXY_URL}                             |
|                                                                    |
|  Configuring Claude Code...                                        |
|    ANTHROPIC_BASE_URL = ${PROXY_URL}/anthropic                    |
|    ANTHROPIC_CUSTOM_HEADERS = X-Osabio-Workspace: ${WORKSPACE_ID}  |
|                                                                    |
|  [OK] Claude Code will route through Osabio proxy                   |
|  [OK] Cost tracking: enabled                                       |
|  [OK] Policy enforcement: enabled                                  |
|                                                                    |
|  To scope to a task:                                               |
|    $ osabio start task:implement-rate-limiting                      |
|    (adds X-Osabio-Task header for cost attribution)                 |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${PROXY_URL}`, `${WORKSPACE_ID}`, `${TASK_ID}` (optional), custom headers
**Emotional state**: Entry: Expectant ("will this break my workflow?") | Exit: Relieved ("that was easy")
**Integration checkpoint**: `ANTHROPIC_BASE_URL` set; proxy reachable; test request succeeds

---

### Step 3: Authenticate (Proxy, Invisible)

```
+-- Step 3: Authenticate (Internal -- not user-visible) -------------+
|                                                                    |
|  Incoming request: POST /proxy/llm/anthropic/v1/messages          |
|                                                                    |
|  Extract identity:                                                 |
|    metadata.user_id -> session: ${SESSION_ID}                     |
|                        account: ${ACCOUNT_ID}                     |
|                        user_hash: ${USER_HASH}                    |
|    X-Osabio-Workspace -> workspace: ${WORKSPACE_ID}                |
|    X-Osabio-Task -> task: ${TASK_ID} (optional)                    |
|    x-api-key -> forwarded to upstream (client's own key)          |
|                                                                    |
|  Identity resolved: Priya @ workspace:marcus/osabio-v1             |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${SESSION_ID}`, `${ACCOUNT_ID}`, `${WORKSPACE_ID}`, `${TASK_ID}`
**Emotional state**: Invisible (developer does not know this is happening)
**Integration checkpoint**: Identity resolved from headers + metadata; workspace validated

---

### Step 4: Authorize (Proxy, Invisible -- blocks on violation)

```
+-- Step 4: Authorize (Internal -- invisible unless blocked) --------+
|                                                                    |
|  Policy evaluation:                                                |
|    Model requested: ${MODEL_ID}                                   |
|    Agent type: coding-agent                                        |
|    Workspace budget remaining: $${BUDGET_REMAINING}               |
|                                                                    |
|  Checks:                                                           |
|    [PASS] Model ${MODEL_ID} allowed for coding-agent              |
|    [PASS] Workspace daily spend $12.40 < $50.00 limit            |
|    [PASS] Rate limit: 45/min < 60/min allowed                    |
|    [PASS] No active policy blocks                                  |
|                                                                    |
|  Result: AUTHORIZED -- proceed to forward                          |
|                                                                    |
|  --- ON VIOLATION ---                                              |
|                                                                    |
|  HTTP 403:                                                         |
|  {                                                                 |
|    "error": "policy_violation",                                    |
|    "message": "Model claude-opus-4 not authorized for agent type  |
|               coding-agent in workspace marcus/osabio-v1",          |
|    "policy_ref": "policy:model-access-prod-v2",                   |
|    "remediation": "Request Opus access from workspace admin or    |
|                    use claude-sonnet-4 instead"                     |
|  }                                                                 |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${MODEL_ID}`, `${BUDGET_REMAINING}`, policy references
**Emotional state**: Invisible on pass; Blocked with clear guidance on violation
**Integration checkpoint**: Policy graph queried; budget counters checked; rate limit verified

---

### Step 5: Forward to Upstream (Proxy, Invisible)

```
+-- Step 5: Forward (Internal -- zero-latency passthrough) ----------+
|                                                                    |
|  Forward to: https://api.anthropic.com/v1/messages                |
|  Headers: x-api-key (client's), anthropic-version, anthropic-beta |
|  Body: unchanged (passthrough)                                     |
|  Stream: true -> SSE pipe via TransformStream                     |
|                                                                    |
|  Timeline:                                                         |
|    T+0ms   Request received from Claude Code                      |
|    T+2ms   Policy check complete (Step 4)                         |
|    T+3ms   Request forwarded to Anthropic                         |
|    T+180ms First SSE event received from Anthropic                |
|    T+181ms First SSE event relayed to Claude Code                 |
|    ...     Events piped through (raw bytes, no transformation)    |
|    T+4200ms message_delta event (usage extracted async)           |
|    T+4201ms message_stop event relayed                            |
|    T+4202ms Stream closed -> trigger async post-processing        |
|                                                                    |
|  Overhead: < 5ms (policy check + header forwarding)               |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${REQUEST_ID}` (Anthropic's), upstream response headers
**Emotional state**: Invisible (developer experiences normal Claude Code latency)
**Integration checkpoint**: Upstream reachable; SSE stream relayed without corruption

---

### Step 6: Capture Trace + Cost (Proxy, Async)

```
+-- Step 6: Capture (Internal -- async, non-blocking) ---------------+
|                                                                    |
|  After stream completes, async pipeline runs:                      |
|                                                                    |
|  1. Extract usage from SSE events:                                 |
|     input_tokens: ${INPUT_TOKENS}                                 |
|     output_tokens: ${OUTPUT_TOKENS}                               |
|     cache_creation_tokens: ${CACHE_CREATE_TOKENS}                 |
|     cache_read_tokens: ${CACHE_READ_TOKENS}                       |
|                                                                    |
|  2. Compute cost:                                                  |
|     model: ${MODEL_ID} -> pricing: ${INPUT_RATE}/${OUTPUT_RATE}   |
|     cost_usd: $${CALL_COST}                                      |
|                                                                    |
|  3. Write graph trace:                                             |
|     CREATE trace SET                                           |
|       model = ${MODEL_ID},                                        |
|       input_tokens = ${INPUT_TOKENS},                             |
|       output_tokens = ${OUTPUT_TOKENS},                           |
|       cost_usd = ${CALL_COST},                                   |
|       latency_ms = ${LATENCY_MS},                                |
|       stop_reason = ${STOP_REASON},                               |
|       request_id = ${REQUEST_ID};                                 |
|                                                                    |
|     RELATE agent_session:${SESSION_ID}                            |
|       -> invoked -> trace:${TRACE_ID};                       |
|     RELATE trace:${TRACE_ID}                                 |
|       -> attributed_to -> task:${TASK_ID};                        |
|     RELATE trace:${TRACE_ID}                                 |
|       -> scoped_to -> workspace:${WORKSPACE_ID};                 |
|                                                                    |
|  4. Update spend counters (async):                                 |
|     workspace daily spend += ${CALL_COST}                         |
|     project spend += ${CALL_COST}                                 |
|     task spend += ${CALL_COST}                                    |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${TRACE_ID}`, `${CALL_COST}`, `${INPUT_TOKENS}`, `${OUTPUT_TOKENS}`, all spend counters
**Emotional state**: Invisible (all async, developer has already received full response)
**Integration checkpoint**: Trace node created in graph; spend counters updated; edges created

---

### Step 7: Monitor Spend + Anomalies (Admin)

```
+-- Step 7: Monitor Spend -------------------------------------------+
|                                                                    |
|  Osabio Dashboard > LLM Proxy > Spend Overview                     |
|                                                                    |
|  Today's Spend: $23.47 / $50.00 daily limit                      |
|  [==================--------] 47%                                  |
|                                                                    |
|  By Project:                                                       |
|  +---------------------------------------------+                  |
|  | Project             | Today  | MTD    | Calls|                  |
|  |---------------------|--------|--------|------|                  |
|  | auth-service        | $12.30 | $89.20 | 342  |                  |
|  | llm-proxy           | $8.17  | $42.50 | 187  |                  |
|  | observer-patterns   | $3.00  | $15.80 | 45   |                  |
|  +---------------------------------------------+                  |
|                                                                    |
|  By Agent Session (today):                                         |
|  +---------------------------------------------+                  |
|  | Session             | Cost   | Model   | Dur  |                  |
|  |---------------------|--------|---------|------|                  |
|  | priya/auth-refactor | $8.40  | sonnet4 | 2.1h |                  |
|  | marcus/proxy-impl   | $6.12  | sonnet4 | 1.5h |                  |
|  | observer/scan-12    | $3.00  | haiku   | 0.3h |                  |
|  +---------------------------------------------+                  |
|                                                                    |
|  Anomaly Alert:                                                    |
|  [!] Session priya/auth-refactor has 342 calls in 2.1h            |
|      (3x average rate). Possible debugging loop detected.          |
|      [Investigate] [Dismiss]                                       |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: All spend counters, session cost aggregates, anomaly thresholds
**Emotional state**: Entry: Checking in | Exit: Informed ("I know where the money goes")
**Integration checkpoint**: Spend data aggregated from trace nodes; anomaly detection thresholds configured

---

### Step 8: Audit Provenance (Auditor)

```
+-- Step 8: Audit Provenance ----------------------------------------+
|                                                                    |
|  Osabio Dashboard > Audit > LLM Trace Detail                       |
|                                                                    |
|  Trace: trace:${TRACE_ID}                                    |
|  +---------------------------------------------+                  |
|  | Field            | Value                     |                  |
|  |------------------|---------------------------|                  |
|  | Model            | claude-sonnet-4            |                  |
|  | Tokens (in/out)  | 12,340 / 2,100            |                  |
|  | Cache (create/rd)| 0 / 8,200                  |                  |
|  | Cost             | $0.068                     |                  |
|  | Latency          | 4,200ms                    |                  |
|  | Stop Reason      | end_turn                   |                  |
|  | Anthropic Req ID | req_01abc123               |                  |
|  +---------------------------------------------+                  |
|                                                                    |
|  Provenance Chain:                                                 |
|                                                                    |
|  [intent:deploy-auth]                                              |
|     -> authorized_by -> [policy:model-access-v2]                  |
|     -> executed_in -> [agent_session:priya-auth-42]               |
|        -> invoked -> [trace:${TRACE_ID}]                     |
|           -> attributed_to -> [task:implement-oauth]              |
|           -> scoped_to -> [workspace:marcus/osabio-v1]             |
|                                                                    |
|  [Export Provenance Chain as JSON]                                 |
|                                                                    |
+--------------------------------------------------------------------+
```

**Shared artifacts**: `${TRACE_ID}`, provenance chain (intent -> policy -> session -> trace -> task -> workspace)
**Emotional state**: Entry: Investigative | Exit: Assured ("complete chain verified")
**Integration checkpoint**: All graph edges traversable; provenance chain complete from intent to trace

---

## Integration Validation Summary

| Shared Artifact | Source of Truth | Consumers | Risk |
|----------------|----------------|-----------|------|
| `${PROXY_URL}` | Workspace settings | osabio init, agent env vars, dashboard | HIGH -- mismatch breaks all routing |
| `${WORKSPACE_ID}` | Workspace record | Custom headers, trace edges, spend counters | HIGH -- wrong workspace = misattributed costs |
| `${SESSION_ID}` | metadata.user_id (Claude Code) | Trace edges, session cost aggregation | HIGH -- missing = unattributed calls |
| `${TASK_ID}` | X-Osabio-Task header / osabio start | Trace edges, task cost rollup | MEDIUM -- optional but degrades attribution |
| `${MODEL_ID}` | Request body .model field | Policy check, cost calculation, trace record | HIGH -- wrong model = wrong cost |
| `${CALL_COST}` | Computed from usage + pricing table | Spend counters, dashboard, audit | HIGH -- inaccurate = broken trust |
| Pricing table | Local config (updated periodically) | Cost calculation | MEDIUM -- stale prices = cost drift |
| Policy graph | Osabio policy engine | Authorization decisions | HIGH -- stale policies = wrong enforcement |
