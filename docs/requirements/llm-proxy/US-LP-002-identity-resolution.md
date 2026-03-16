# US-LP-002: Identity Resolution from Agent Metadata

## Problem
Marcus Olsson is a workspace admin who cannot tell which developer or agent made a specific LLM call. The proxy receives requests but has no way to attribute them to a person, agent session, or workspace. Today, `metadata.user_id` is parsed and logged but not connected to any identity in the Brain graph.

## Who
- Workspace Admin | Manages multiple developers and agents | Needs to know who made each LLM call
- Developer | Uses Claude Code through proxy | Wants attribution to happen automatically

## Job Story Trace
- JS-1: Transparent Cost Visibility (requires identity to attribute costs)
- JS-4: Auditable Agent Provenance (requires identity for provenance chain)

## Solution
Extract identity from Claude Code's `metadata.user_id` field and `X-Brain-Workspace` / `X-Brain-Task` custom headers. Resolve to workspace, session, and optional task. Gracefully degrade when identity signals are partial.

## Domain Examples

### 1: Happy Path -- Full identity from Claude Code metadata + headers
Priya's Claude Code sends a request with `metadata.user_id: "user_a1b2c3_account_550e8400-e29b-41d4-a716-446655440000_session_6ba7b810-9dad-11d1-80b4-00c04fd430c8"` and headers `X-Brain-Workspace: brain-v1` and `X-Brain-Task: implement-oauth`. The proxy resolves: workspace=brain-v1, session=6ba7b810..., account=550e8400..., task=implement-oauth. All subsequent trace edges use these identifiers.

### 2: Edge Case -- Metadata present but no task header
Priya forgot to run `brain start` for this session. Her request has `metadata.user_id` and `X-Brain-Workspace` but no `X-Brain-Task`. The proxy resolves workspace and session but creates the trace with `attributed_to` edge omitted. Cost is attributed to workspace only, not to a specific task.

### 3: Edge Case -- No metadata at all (third-party agent)
A custom automation script calls the proxy with `X-Brain-Workspace: brain-v1` but no `metadata.user_id` (it is not Claude Code). The proxy resolves workspace from the header. The trace is created with session_id omitted. Cost is attributed to workspace only.

### 4: Error Path -- Invalid workspace header
A request arrives with `X-Brain-Workspace: nonexistent-workspace`. The proxy cannot resolve the workspace. The request is still forwarded (the client's own API key authenticates with Anthropic), but a warning observation is created: "LLM call from unresolved workspace: nonexistent-workspace". The trace is created without workspace edge.

## UAT Scenarios (BDD)

### Scenario: Full identity resolution from Claude Code
Given a request includes metadata.user_id "user_a1b2c3_account_550e8400-e29b-41d4-a716-446655440000_session_6ba7b810-9dad-11d1-80b4-00c04fd430c8"
And the request includes header X-Brain-Workspace "brain-v1"
And the request includes header X-Brain-Task "implement-oauth"
When the proxy resolves identity
Then session_id is "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
And account_id is "550e8400-e29b-41d4-a716-446655440000"
And workspace is "brain-v1"
And task is "implement-oauth"

### Scenario: Graceful degradation without task header
Given a request includes metadata.user_id with valid session and account
And the request includes X-Brain-Workspace "brain-v1"
And no X-Brain-Task header is present
When the proxy resolves identity
Then workspace and session are resolved
And the trace is created without an attributed_to edge to any task
And the request is forwarded normally

### Scenario: Graceful degradation without any metadata
Given a request includes X-Brain-Workspace "brain-v1"
And no metadata.user_id is present
When the proxy resolves identity
Then workspace is resolved from the header
And the trace is created with session_id omitted
And the request is forwarded normally

### Scenario: Invalid workspace produces warning
Given a request includes X-Brain-Workspace "nonexistent-workspace"
When the proxy resolves identity
Then the request is forwarded (client's API key authenticates with Anthropic)
And a warning observation is created noting the unresolved workspace
And the trace is created without a workspace edge

## Acceptance Criteria
- [ ] Claude Code metadata.user_id parsed into session_id, account_id, and user_hash
- [ ] X-Brain-Workspace header resolved to workspace record
- [ ] X-Brain-Task header resolved to task record (when present)
- [ ] Missing metadata gracefully degrades (workspace-only or no attribution)
- [ ] Invalid workspace triggers warning observation but does not block the request
- [ ] Identity fields propagated to trace capture step (session, workspace, task)

## Technical Notes
- Existing `parseMetadataUserId()` in walking skeleton handles Claude Code format
- Workspace validation should be cached (workspace records change infrequently)
- Task validation optional but recommended (invalid task ID should warn, not block)
- Identity resolution must complete within the 10ms policy check budget

## Dependencies
- US-LP-001 (proxy passthrough must work before identity resolution adds value)
