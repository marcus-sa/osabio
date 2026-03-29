# Acceptance Criteria: Claude Agent SDK Migration

## AC-1: Agent SDK Spawn

### AC-1.1: query() invocation
```gherkin
Given a validated task assignment and a created worktree
When spawnAgent() is called
Then it invokes query() from @anthropic-ai/claude-agent-sdk
And passes the worktree path as options.cwd
And passes a system prompt containing the task ID
And returns an AgentHandle with abort and typed event iterator
```

### AC-1.2: No external process management
```gherkin
Given the new spawnAgent implementation
Then it does NOT spawn a child process via node:child_process
And it does NOT allocate a network port
And it does NOT parse stdout for readiness signals
```

### AC-1.3: Abort via AbortController
```gherkin
Given an active agent session
When abort() is called on the AgentHandle
Then the AbortController signal is triggered
And the query() async iterator terminates
And resources are cleaned up
```

### AC-1.4: Session completion detection
```gherkin
Given an active agent session
When the query() iterator yields a message with type "result"
Then the session transitions to "idle" or "completed"
And the stall detector is stopped
```

### AC-1.5: Spawn failure rollback
```gherkin
Given a valid assignment
When query() throws during initialization
Then the worktree is removed
And the agent_session DB record is deleted
And a SessionError with code "SESSION_ERROR" is returned
```

## AC-2: Osabio MCP Server

### AC-2.1: Stdio transport configuration
```gherkin
Given the Agent SDK options builder
When buildAgentOptions() is called
Then options.mcpServers contains a "brain" server
And the server type is "stdio"
And the command is "brain" with args ["mcp"]
```

### AC-2.2: All Osabio tools available
```gherkin
Given an active agent session with Osabio MCP configured
Then the agent can invoke get_context, get_task_context, create_provisional_decision,
     update_task_status, and all other Osabio MCP tools
And no tools are defined outside the MCP server
```

### AC-2.3: No duplicate tool definitions
```gherkin
Given the new integration
Then Osabio tools are defined only in cli/mcp-server.ts
And no tool definitions exist in hook callbacks or config builders
```

## AC-3: Lifecycle Hooks

### AC-3.1: SessionStart hook
```gherkin
Given the Agent SDK options
When the agent session starts
Then the SessionStart hook executes
And it calls the Osabio API to load workspace/project context
And the context is available to the agent
```

### AC-3.2: PreToolUse hook
```gherkin
Given an active agent session
When the agent invokes a tool
Then the PreToolUse hook receives tool_name and tool_input
And for subagent dispatch tools, osabio context is injected
```

### AC-3.3: UserPromptSubmit hook
```gherkin
Given an active agent session
When a follow-up prompt is submitted
Then the UserPromptSubmit hook checks for workspace-level graph updates
```

### AC-3.4: Stop hook
```gherkin
Given an active agent session
When the agent reaches a stop point
Then the Stop hook reviews unlogged decisions, questions, and observations
And logs any missing items to the knowledge graph
```

### AC-3.5: PreCompact hook
```gherkin
Given an active agent session
When context compaction is triggered
Then the PreCompact hook loads current osabio context
And the context is preserved across the compaction boundary
```

### AC-3.6: SessionEnd hook
```gherkin
Given an agent session ending
When the SessionEnd hook executes
Then it calls osabio system end-session
And the session summary is recorded in the knowledge graph
```

## AC-4: Event Stream Translation

### AC-4.1: SDK messages to StreamEvents
```gherkin
Given an SDK message with type "assistant"
When the event translator processes it
Then it produces a StreamEvent compatible with the existing SSE contract
And the browser UI renders the message unchanged
```

### AC-4.2: Result messages to completion events
```gherkin
Given an SDK message with type "result" and subtype "success"
When the event translator processes it
Then it produces a "done" StreamEvent
And includes duration and usage metadata
```

### AC-4.3: Error messages
```gherkin
Given an SDK message with type "result" and an error subtype
When the event translator processes it
Then it produces an "error" StreamEvent with the error details
```

## AC-5: Options Builder

### AC-5.1: Pure function
```gherkin
Given Osabio config (brainBaseUrl, workspaceId, authToken, taskId)
When buildAgentOptions() is called
Then it returns a complete Options object
And the function has no side effects
```

### AC-5.2: Permission bypass
```gherkin
Given the built options
Then permissionMode is "bypassPermissions"
And allowDangerouslySkipPermissions is true
```

### AC-5.3: Hook callbacks included
```gherkin
Given the built options
Then options.hooks contains entries for SessionStart, PreToolUse,
     UserPromptSubmit, Stop, PreCompact, and SessionEnd
```

## AC-6: OpenCode Removal

### AC-6.1: Dependencies removed
```gherkin
Given the updated package.json
Then @opencode-ai/sdk is not listed as a dependency
And @opencode-ai/plugin is not listed as a dependency
```

### AC-6.2: OpenCode spawn code removed
```gherkin
Given the codebase
Then spawn-opencode.ts is deleted or fully rewritten
And no imports from @opencode-ai/* exist
```

### AC-6.3: Init command updated
```gherkin
Given the osabio init command
Then setupOpencode() no longer generates .opencode/plugins/osabio.ts
And opencode.json generation uses MCP-only config (no plugin references)
And OPENCODE_PLUGIN_CONTENT is removed from init-content.ts
```

### AC-6.4: Tests updated
```gherkin
Given the test suite
Then opencode-plugin-init.test.ts is updated or removed
And SpawnOpenCodeFn references are replaced with SpawnAgentFn
And all tests pass
```

## AC-7: ADR

### AC-7.1: ADR supersession
```gherkin
Given ADR-003-opencode-plugin-over-mcp.md
Then its status is changed to "Superseded by ADR-00X"
And a new ADR documents the Claude Agent SDK decision
And the new ADR references the hook parity table and MCP integration rationale
```
