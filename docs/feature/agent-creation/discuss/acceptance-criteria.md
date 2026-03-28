<!-- markdownlint-disable MD024 -->

# Acceptance Criteria: Agent Management

## Consolidated Acceptance Criteria by Story

### US-01: View Agent Registry

- [ ] Agents page accessible via navigation bar
- [ ] Agents grouped by runtime type in separate sections (brain, sandbox, external)
- [ ] Brain agents display "View" action only (no edit/delete/spawn)
- [ ] Sandbox agents display "Spawn" and "Edit" actions
- [ ] External agents display "Edit" action
- [ ] Delete action available on sandbox and external agents
- [ ] Empty states with create guidance shown when no custom agents exist
- [ ] Page header shows total agent count
- [ ] Each card shows runtime badge with color + text label
- [ ] Page loads in under 2 seconds for up to 50 agents

### US-02: Create External Agent with Authority Scopes

- [ ] External agent creation executes 5-step transaction atomically
- [ ] Proxy token generated with cryptographic randomness and "brp_" prefix
- [ ] Proxy token displayed once with copy-to-clipboard button
- [ ] Warning that token cannot be retrieved after dialog close
- [ ] Connection instructions (BRAIN_SERVER_URL, BRAIN_AUTH_TOKEN, BRAIN_WORKSPACE_ID) in confirmation
- [ ] Duplicate agent name produces inline validation error
- [ ] Transaction failure leaves no partial records (agent, identity, edges)
- [ ] Authority scopes default to "propose" for all actions
- [ ] Creation completes in under 3 seconds

### US-03: View Agent Detail Page

- [ ] Detail page shows agent name, description, runtime badge
- [ ] Sandbox agents show sandbox configuration fields (coding agents, env vars, model; image/snapshot only for cloud providers)
- [ ] External agents show connection status
- [ ] Authority scopes displayed as action-permission pairs for all runtimes
- [ ] Brain agent detail is read-only with explanatory note
- [ ] Back navigation preserves filter state on agents page

### US-04: Delete Agent with Confirmation

- [ ] Delete requires typing agent name to confirm
- [ ] Confirmation dialog lists all records that will be removed
- [ ] Deletion removes: agent, identity, identity_agent, member_of, authorized_to edges
- [ ] Deletion is transactional (all or nothing)
- [ ] Brain agents have no delete action
- [ ] Historical session records preserved after agent deletion

### US-05: Create Sandbox Agent with Configuration

- [ ] Sandbox creation form shows provider-appropriate fields (all: coding agents, env vars; cloud only: image, snapshot)
- [ ] Workspace without sandbox provider shows warning and blocks creation
- [ ] Link to Settings provided when sandbox provider not configured
- [ ] Environment variables support add/remove key-value pairs
- [ ] Coding agents displayed as checkboxes
- [ ] Image field has placeholder showing provider default
- [ ] Sandbox config stored on agent.sandbox_config object

### US-06: Filter Agents by Runtime Type

- [ ] Filter tabs show count per runtime type
- [ ] Selecting tab filters card grid to that runtime
- [ ] "All" tab shows complete registry grouped by runtime
- [ ] Empty filter state shows guidance to create agents
- [ ] Filter state preserved on back navigation from detail page

### US-07: Spawn Sandbox Session from Agent Detail

- [ ] "Spawn Session" button visible only on sandbox agent detail pages
- [ ] Optional task selection to scope the session
- [ ] New session appears in active list with "spawning" status
- [ ] Spawn failure shows actionable error message with retry
- [ ] External and brain agents do not show spawn action

### US-08: View Session List on Agent Detail

- [ ] Sessions grouped by status: active, idle, completed/error
- [ ] Active sessions show task name and last event timestamp
- [ ] Idle sessions show "Resume" and "Send Feedback" actions
- [ ] Error sessions display error message
- [ ] Completed sessions show duration
- [ ] Empty state with guidance when no sessions exist

### US-09: Edit Agent Configuration and Authority Scopes

- [ ] Edit form pre-populated with current values
- [ ] Authority scope changes update authorized_to edges transactionally
- [ ] Agent name change syncs to identity record name
- [ ] Sandbox config changes apply to next spawned session (not active ones)
- [ ] Brain agents cannot be edited (no Edit action available)
- [ ] Save provides confirmation feedback within 100ms

### US-10: Resume or Send Feedback to Idle Sessions

- [ ] "Resume" and "Send Feedback" actions on idle session rows only
- [ ] Feedback text input with send confirmation
- [ ] Session status updates from "idle" to "active" after resume/feedback
- [ ] Active and completed sessions have no resume/feedback actions

### US-11: View External Agent Connection Status

- [ ] Connection status visible on external agent detail pages only
- [ ] Online/Offline/Never connected states based on last proxy request
- [ ] Last seen timestamp displayed
- [ ] Never connected state shows setup guidance with connection instructions

### US-12: Delete Agent with Active Session Warning

- [ ] Active/idle sessions detected and listed in delete dialog
- [ ] Warning text includes session count and task names
- [ ] Sessions terminated with "aborted" status before record removal
- [ ] Cancel leaves everything intact (agent + sessions)
- [ ] No-session deletions skip session warning section

### US-13: Empty States for Agent Sections

- [ ] Empty state shown per section when no agents of that runtime exist
- [ ] Explanatory text describes what agents of that type do
- [ ] Call-to-action button starts creation with runtime pre-selected
- [ ] Brain agent section never shows empty state

## Cross-Cutting Acceptance Criteria

### Accessibility

- [ ] All interactive elements reachable via keyboard (Tab navigation)
- [ ] Focus indicators visible on all interactive elements
- [ ] Runtime badges use color paired with text labels (not color alone)
- [ ] Minimum contrast ratio 4.5:1 for all text
- [ ] Form fields have associated labels
- [ ] Error messages identify the field and suggest correction

### Error Handling

- [ ] All error messages explain what happened, why, and what to do next
- [ ] No raw error codes or technical stack traces in user-facing output
- [ ] Transactional operations leave no partial state on failure
- [ ] Network errors provide retry option

### Consistency

- [ ] Same action looks and behaves the same across all agent types
- [ ] Authority scope component shared between creation and edit forms
- [ ] Terminology consistent: "agent", "runtime", "authority scope", "session"
- [ ] Destructive actions (delete) always require explicit confirmation
