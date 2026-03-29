# ADR-072: Unified Multi-Turn Tool Loop

## Status
Proposed

## Context

The proxy's tool use interception loop (Step 8.5 in `anthropic-proxy-route.ts`) handles osabio-native and integration tool calls in separate branches within each iteration. When the LLM response contains `tool_use` blocks, the loop classifies them and enters either the osabio-native branch or the integration branch -- but not both.

The Anthropic Messages API allows multiple `tool_use` blocks per response. An LLM can call `search_entities` (osabio-native) and `github.create_issue` (integration) in the same response. The current two-branch design drops one category in this scenario: if `hasBrainNative` is true, the integration branch is skipped entirely.

Additionally, the current loop has `MAX_TOOL_USE_ITERATIONS = 5`. DISCUSS wave requirements specify 10 iterations as the safety limit (FR-UI-11).

## Decision

### Unified execution per iteration

Each loop iteration processes ALL classified tool calls from the response:

1. Extract `tool_use` blocks from LLM response
2. Classify all blocks (osabio-native, integration, unknown)
3. If all unknown, break (pass through to runtime)
4. Execute osabio-native calls via `executeBrainNativeTools` (existing)
5. Execute integration calls via `executeIntegrationToolsViaMcp` (new, MCP protocol)
6. Combine all results into a single `tool_result` message
7. Send follow-up request to LLM with combined results
8. Repeat until LLM produces non-tool-use response or max iterations reached

Unknown tool calls within a mixed response receive an `is_error: true` tool_result stating the tool is not registered, allowing the LLM to recover gracefully.

### Max iterations increased to 10

`MAX_TOOL_USE_ITERATIONS` increased from 5 to 10 to match the documented requirement.

## Alternatives Considered

### Alternative 1: Keep separate branches, execute sequentially
- **What**: Run osabio-native branch first, then integration branch, in two sub-steps per iteration.
- **Expected impact**: Handles mixed calls but doubles code paths.
- **Why rejected**: Still requires combining results and building a single follow-up message. The unified approach is simpler: one classification pass, parallel execution, one result merge, one follow-up request. Less code, easier to reason about.

### Alternative 2: Reject mixed tool calls with error
- **What**: If a response contains both osabio-native and integration tool calls, return an error tool_result for all of them.
- **Expected impact**: Simplest implementation.
- **Why rejected**: Artificially limits LLM behavior. The LLM reasonably calls tools from different sources when solving a complex task (e.g., "search Osabio's graph for the task, then create a GitHub issue"). Rejecting this forces the LLM into unnecessary sequential behavior.

## Consequences
- **Positive**: Handles all tool call combinations (osabio-native only, integration only, mixed, unknown)
- **Positive**: Single code path instead of two branches -- simpler to maintain
- **Positive**: Unknown tools in mixed responses get graceful error results instead of being silently dropped
- **Positive**: Max iterations aligns with documented requirement (10)
- **Negative**: Slightly more complex result merging logic
- **Negative**: Osabio-native and integration tools execute sequentially within an iteration (could be parallelized later if latency is an issue)
