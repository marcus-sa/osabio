# Component Boundaries: Intent-Gated MCP Tool Access

## Module Map

All new modules live under `app/src/server/mcp/`. Each module has a single responsibility, clear dependencies, and explicit types.

```
app/src/server/mcp/
  agent-mcp-route.ts        # Route handler (effect boundary)
  agent-mcp-auth.ts         # Proxy token -> session resolution (effect boundary)
  scope-engine.ts           # Effective scope computation (pure core + query port)
  tools-list-handler.ts     # tools/list response builder (pure core)
  tools-call-handler.ts     # tools/call orchestration (effect boundary)
  create-intent-handler.ts  # create_intent MCP tool (effect boundary)
  error-response-builder.ts # Structured 403 builder (pure)
```

---

## Module 1: agent-mcp-route.ts

**Responsibility**: HTTP route handler for `POST /mcp/agent/:sessionName`. Parses JSON-RPC envelope, authenticates via proxy token, dispatches to the appropriate handler based on `method` field.

**Dependencies**:
- `agent-mcp-auth.ts` (authentication)
- `tools-list-handler.ts` (tools/list dispatch)
- `tools-call-handler.ts` (tools/call dispatch)
- `create-intent-handler.ts` (create_intent dispatch)
- `http/response.ts` (JSON response helpers)
- `http/instrumentation.ts` (withTracing)

**Type signatures** (ports):

```typescript
type AgentMcpRouteDeps = {
  readonly surreal: Surreal;
  readonly mcpClientFactory: McpClientFactory;
  readonly toolEncryptionKey: string;
  readonly llmEvaluator: LlmEvaluator;
  readonly inflight: InflightTracker;
};

// Route registration: called from start-server.ts
type RegisterAgentMcpRoute = (deps: AgentMcpRouteDeps) => RouteHandler;
```

**Effect boundary**: This is where IO happens (HTTP request parsing, response writing, tracing span management).

---

## Module 2: agent-mcp-auth.ts

**Responsibility**: Resolve a proxy token from `X-Brain-Auth` header into a fully resolved session context (workspace, identity, session ID, session record). Fail fast on invalid/expired tokens or missing sessions.

**Dependencies**:
- `proxy/proxy-auth.ts` (resolveProxyAuth, LookupProxyToken)
- SurrealDB (session record lookup)

**Type signatures**:

```typescript
type AgentSessionContext = {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly sessionId: string;
  readonly sessionRecord: RecordId<"agent_session", string>;
  readonly workspaceRecord: RecordId<"workspace", string>;
  readonly identityRecord: RecordId<"identity", string>;
};

type ResolveAgentSession = (
  headers: Headers,
  lookupToken: LookupProxyToken,
  tokenCache: TokenCache,
  surreal: Surreal,
) => Promise<AgentSessionContext>;  // throws on auth failure
```

**Effect boundary**: DB read for session record. Auth errors throw (caught by route handler).

---

## Module 3: scope-engine.ts

**Responsibility**: Compute the effective tool scope for a session. Queries `gates` edges to find all authorized intents, unions their `authorization_details`, and classifies each registered tool as authorized, gated, or ungated (Brain-native).

**Dependencies**:
- `proxy/tool-resolver.ts` (resolveToolsForIdentity for can_use grants)
- `oauth/rar-verifier.ts` (findMatchingAuthorization for scope matching -- pure)
- `oauth/types.ts` (BrainAction)
- `intent/types.ts` (IntentRecord, ActionSpec)

**Type signatures**:

```typescript
// --- Query port (injectable) ---
type QuerySessionIntents = (
  sessionRecord: RecordId<"agent_session", string>,
) => Promise<AuthorizedIntentSummary[]>;

type AuthorizedIntentSummary = {
  readonly intentId: string;
  readonly authorizationDetails: BrainAction[];
};

// --- Pure types ---
type ToolClassification =
  | { readonly kind: "authorized"; readonly matchingIntent: AuthorizedIntentSummary }
  | { readonly kind: "gated" }
  | { readonly kind: "brain_native" };

type EffectiveScope = {
  readonly authorizedActions: BrainAction[];
  readonly intents: AuthorizedIntentSummary[];
};

type ClassifiedTool = {
  readonly tool: ResolvedTool;
  readonly classification: ToolClassification;
};

// --- Pure functions ---
type ComputeEffectiveScope = (
  intents: AuthorizedIntentSummary[],
) => EffectiveScope;

type ClassifyTools = (
  grantedTools: ResolvedTool[],
  effectiveScope: EffectiveScope,
  brainNativeToolNames: ReadonlySet<string>,
) => ClassifiedTool[];

// --- Effect boundary (composition root) ---
type ResolveSessionScope = (
  sessionRecord: RecordId<"agent_session", string>,
  identityId: string,
  workspaceId: string,
  queryIntents: QuerySessionIntents,
  queryGrantedTools: QueryGrantedTools,
  toolResolutionCache: ToolResolutionCache,
) => Promise<{
  scope: EffectiveScope;
  classifiedTools: ClassifiedTool[];
}>;
```

**Pure core**: `computeEffectiveScope` and `classifyTools` are pure functions operating on data. `resolveSessionScope` is the composition root with DB queries at the boundary.

---

## Module 4: tools-list-handler.ts

**Responsibility**: Build an MCP `ListToolsResult` response from classified tools. Authorized tools get their full definition. Gated tools get enriched descriptions instructing the agent to call `create_intent`. Brain-native tools (create_intent, get_context) are always included.

**Dependencies**:
- `scope-engine.ts` (ClassifiedTool)
- `error-response-builder.ts` (gated tool description enrichment)

**Type signatures**:

```typescript
type McpToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

type ListToolsResult = {
  readonly tools: McpToolDefinition[];
};

// Pure function
type BuildToolsList = (
  classifiedTools: ClassifiedTool[],
  brainNativeTools: McpToolDefinition[],
) => ListToolsResult;
```

**Pure**: No IO. Transforms classified tools into MCP protocol response.

---

## Module 5: tools-call-handler.ts

**Responsibility**: Orchestrate a tool call: check scope, validate constraints, forward to upstream MCP server, record trace. Returns MCP `CallToolResult` on success, structured error on failure.

**Dependencies**:
- `scope-engine.ts` (EffectiveScope)
- `oauth/rar-verifier.ts` (verifyOperationScope, findExceededConstraint)
- `tool-registry/mcp-client.ts` (McpClientFactory)
- `proxy/tool-trace-writer.ts` (captureToolTrace)
- `error-response-builder.ts` (403 responses)
- `tool-registry/server-queries.ts` (getMcpServerById for upstream lookup)
- `proxy/credential-resolver.ts` (resolveCredentialsForTool)

**Type signatures**:

```typescript
type ToolCallInput = {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly requestId: string | number;
};

type ToolCallOutcome =
  | { readonly kind: "success"; readonly result: unknown }
  | { readonly kind: "intent_required"; readonly toolName: string; readonly actionSpecTemplate: ActionSpecTemplate }
  | { readonly kind: "constraint_violated"; readonly field: string; readonly requested: unknown; readonly authorized: unknown }
  | { readonly kind: "upstream_error"; readonly error: string; readonly statusCode?: number }
  | { readonly kind: "timeout" };

type ActionSpecTemplate = {
  readonly provider: string;
  readonly action: string;
  readonly parameterSchema?: Record<string, unknown>;
};

// Effect boundary
type HandleToolCall = (
  input: ToolCallInput,
  sessionContext: AgentSessionContext,
  scope: EffectiveScope,
  grantedTools: ResolvedTool[],
  deps: ToolCallDeps,
) => Promise<ToolCallOutcome>;

type ToolCallDeps = {
  readonly surreal: Surreal;
  readonly mcpClientFactory: McpClientFactory;
  readonly toolEncryptionKey: string;
};
```

**Effect boundary**: Upstream MCP call, trace write, credential resolution.

---

## Module 6: create-intent-handler.ts

**Responsibility**: Handle the `create_intent` Brain-native MCP tool. Creates an intent record, submits it through the policy gate and LLM evaluator, creates a `gates` edge linking the intent to the session, and returns the outcome.

**Dependencies**:
- `intent/intent-queries.ts` (createIntent, updateIntentStatus)
- `intent/authorizer.ts` (evaluateIntent)
- `intent/status-machine.ts` (transitionStatus)
- `policy/policy-gate.ts` (evaluatePolicyGate)
- `oauth/types.ts` (BrainAction, createBrainAction)
- SurrealDB (RELATE for gates edge)

**Type signatures**:

```typescript
type CreateIntentInput = {
  readonly goal: string;
  readonly reasoning: string;
  readonly actionSpec: ActionSpec;
};

type CreateIntentOutcome =
  | { readonly status: "authorized"; readonly intentId: string }
  | { readonly status: "pending_veto"; readonly intentId: string }
  | { readonly status: "vetoed"; readonly intentId: string; readonly reason: string };

// Effect boundary
type HandleCreateIntent = (
  input: CreateIntentInput,
  sessionContext: AgentSessionContext,
  deps: CreateIntentDeps,
) => Promise<CreateIntentOutcome>;

type CreateIntentDeps = {
  readonly surreal: Surreal;
  readonly llmEvaluator: LlmEvaluator;
};
```

**Effect boundary**: Intent creation (DB write), policy evaluation (DB read), gates edge creation (DB write), LLM evaluation (external call).

**Gates edge direction**: Per the existing schema `DEFINE TABLE gates TYPE RELATION IN intent OUT agent_session`, the RELATE statement is:
```sql
RELATE $intent->gates->$sess SET created_at = time::now();
```
This matches the existing pattern in `session-lifecycle.ts:transitionIntentToExecuting`.

---

## Module 7: error-response-builder.ts

**Responsibility**: Build structured error responses for the MCP protocol. The primary concern is the `intent_required` 403 response with `action_spec_template` that guides the agent to create an intent.

**Dependencies**:
- `tool-registry/types.ts` (McpToolRecord for parameter schema)

**Type signatures**:

```typescript
type IntentRequiredError = {
  readonly code: -32403;
  readonly message: "intent_required";
  readonly data: {
    readonly tool: string;
    readonly action_spec_template: ActionSpecTemplate;
  };
};

type ConstraintViolationError = {
  readonly code: -32403;
  readonly message: "constraint_violation";
  readonly data: {
    readonly field: string;
    readonly requested: unknown;
    readonly authorized: unknown;
  };
};

// Pure functions
type BuildIntentRequiredError = (
  toolName: string,
  toolkit: string,
  parameterSchema?: Record<string, unknown>,
) => IntentRequiredError;

type BuildConstraintViolationError = (
  field: string,
  requested: unknown,
  authorized: unknown,
) => ConstraintViolationError;

// Gated tool description enrichment (pure)
type EnrichGatedDescription = (
  originalDescription: string,
  toolkit: string,
  action: string,
) => string;
```

**Pure**: No IO. String manipulation and object construction only.

---

## Dependency Graph

```
agent-mcp-route
  |-- agent-mcp-auth
  |     |-- proxy/proxy-auth (existing)
  |     |-- SurrealDB (session lookup)
  |
  |-- tools-list-handler (pure)
  |     |-- scope-engine
  |     |-- error-response-builder (pure)
  |
  |-- tools-call-handler
  |     |-- scope-engine
  |     |-- oauth/rar-verifier (existing, pure)
  |     |-- tool-registry/mcp-client (existing)
  |     |-- proxy/tool-trace-writer (existing)
  |     |-- proxy/credential-resolver (existing)
  |     |-- error-response-builder (pure)
  |
  |-- create-intent-handler
        |-- intent/intent-queries (existing)
        |-- intent/authorizer (existing)
        |-- policy/policy-gate (existing)
        |-- oauth/types (existing, pure)
```

**Inward dependency rule**: Pure modules (`scope-engine` pure functions, `tools-list-handler`, `error-response-builder`) never depend on effect modules. Effect modules depend on pure modules. The route handler is the composition root.

---

## Brain-Native Tools for Agent MCP

The Agent MCP endpoint provides these Brain-native tools to every session:

| Tool | Description | Always Available |
|------|-------------|-----------------|
| `create_intent` | Create an intent for tool access escalation | Yes |
| `get_context` | Load workspace context (existing MCP tool) | Yes |
| `search_entities` | Search workspace knowledge graph | Yes |
| `get_entity_detail` | Fetch entity with relationships | Yes |
| `create_observation` | Record an observation | Yes |

These are registered in the tools/list response as non-gated tools. They do not require intent authorization.
