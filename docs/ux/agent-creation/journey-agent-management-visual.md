<!-- markdownlint-disable MD024 -->

# Journey: Agent Management

## Personas

### Persona 1: Elena Vasquez (Workspace Admin)

- **Who**: Operations lead at a logistics company using Osabio to coordinate autonomous agents across supply chain monitoring, compliance auditing, and demand forecasting
- **Context**: Manages a fleet of 12 agents -- 6 brain-controlled (system), 3 sandbox (custom workflows), 3 external (partner integrations)
- **Technical proficiency**: Comfortable with web dashboards, understands authority/governance concepts, does not write code
- **Motivation**: Ensure agents operate within defined boundaries while giving her team autonomy to extend capabilities

### Persona 2: Rafael Oliveira (Developer)

- **Who**: Senior engineer building custom agents for a manufacturing quality control system that connects to Osabio via the LLM proxy
- **Context**: Builds Vercel AI SDK agents that connect as external agents, and sandbox agents for automated code review
- **Technical proficiency**: Writes TypeScript, understands MCP protocol, comfortable with API tokens
- **Motivation**: Register agents quickly without database manipulation, configure authority scopes precisely

## Emotional Arc

```
Start: Uncertain/Curious     Middle: Focused/In-Control     End: Confident/Empowered
"What agents exist?          "I see exactly what each       "The agent is live and
 Can I add my own?"           agent can do and how           governed. I trust this
                              to configure a new one."       system."
```

Pattern: **Confidence Building** -- complex multi-step operations where each micro-success builds trust.

## Journey Flow

```
[Navigate to Agents] --> [View Registry] --> [Create Agent] --> [Configure] --> [Verify & Deploy]
     |                      |                    |                  |                |
  Feels: Curious         Sees: Fleet         Picks: Runtime     Sets: Authority   Feels: Confident
  Needs: Orientation     overview with        type (sandbox     scopes, sandbox    Agent is live,
                         runtime badges       or external)      config             governed, visible
```

## Step 1: Navigate to Agents Page

### Emotional State

- Entry: Curious, possibly uncertain ("Where do I manage agents?")
- Exit: Oriented, clear ("I see the full picture")

### Wireframe

```
+------------------------------------------------------------------+
| Osabio  [Chat] [Feed] [Graph] [Agents*] [Settings]                |
+------------------------------------------------------------------+
|                                                                   |
|  Agents (12)                                    [+ Create Agent]  |
|                                                                   |
|  [All] [Brain (6)] [Sandbox (3)] [External (3)]                  |
|                                                                   |
|  +-- Osabio Agents (read-only) --------------------------------+  |
|  |                                                             |  |
|  | [Architect]         [Observer]         [PM Agent]           |  |
|  |  System agent        System agent       System agent        |  |
|  |  osabio | active      osabio | active     osabio | active      |  |
|  |  [View]              [View]             [View]              |  |
|  |                                                             |  |
|  | [Chat Agent]        [Strategist]       [Design Partner]     |  |
|  |  System agent        System agent       System agent        |  |
|  |  osabio | active      osabio | active     osabio | active      |  |
|  |  [View]              [View]             [View]              |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  +-- Sandbox Agents -------------------------------------------+  |
|  |                                                             |  |
|  | [QC Inspector]      [Code Reviewer]    [Demand Forecaster]  |  |
|  |  Quality control     Automated review   Supply chain        |  |
|  |  sandbox | 2 active  sandbox | idle     sandbox | idle      |  |
|  |  [Spawn] [Edit]      [Spawn] [Edit]    [Spawn] [Edit]      |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  +-- External Agents ------------------------------------------+  |
|  |                                                             |  |
|  | [Compliance Bot]    [Partner ERP]      [Freight Tracker]    |  |
|  |  Audit automation    SAP integration    Real-time tracking  |  |
|  |  external | online   external | offline external | online   |  |
|  |  [Edit]              [Edit]            [Edit]               |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

### Design Notes

- Runtime badge uses color coding paired with text label (accessibility): brain=blue, sandbox=green, external=purple
- Osabio agents section marked "read-only" with lock icon
- Filter tabs allow quick focus by runtime type
- Card actions differ by runtime (brain: View only; sandbox: Spawn/Edit/Delete; external: Edit/Delete)
- Empty state for each section guides first-time creation

## Step 2: Create Agent -- Runtime Selection

### Emotional State

- Entry: Purposeful ("I know I need a new agent")
- Exit: Committed ("I have chosen the right type")

### Wireframe

```
+------------------------------------------------------------------+
| Create Agent                                              [x]     |
+------------------------------------------------------------------+
|                                                                   |
|  What kind of agent are you creating?                             |
|                                                                   |
|  +---------------------------+  +---------------------------+     |
|  | [*] Sandbox Agent         |  | [ ] External Agent        |     |
|  |                           |  |                           |     |
|  | Runs in an isolated       |  | Pre-existing agent that   |     |
|  | environment managed by    |  | connects to Osabio via     |     |
|  | Osabio. You configure the  |  | the LLM proxy. You       |     |
|  | coding agents, env vars,  |  | provide name and          |     |
|  | and coding agents.        |  | authority scopes.         |     |
|  |                           |  |                           |     |
|  | Best for: automated       |  | Best for: partner         |     |
|  | workflows, code review,   |  | integrations, custom      |     |
|  | research tasks            |  | SDK agents, external      |     |
|  |                           |  | services                  |     |
|  +---------------------------+  +---------------------------+     |
|                                                                   |
|  Osabio agents are managed by the system and cannot be created     |
|  through this interface.                                          |
|                                                                   |
|                                          [Cancel]  [Continue ->]  |
+-------------------------------------------------------------------+
```

### Design Notes

- Two-option selection (not three -- osabio is excluded from creation)
- Each card explains the runtime model in domain language
- "Best for" examples use real-world scenarios, not technical jargon
- Informational note about osabio agents prevents confusion
- Progressive disclosure: details appear only after runtime selection

## Step 3: Configure Agent -- Sandbox Path

### Emotional State

- Entry: Focused ("I am configuring my agent")
- Exit: Confident ("The configuration looks right")

### Wireframe (Sandbox Agent)

```
+------------------------------------------------------------------+
| Create Sandbox Agent                                     [x]      |
+------------------------------------------------------------------+
|                                                                   |
|  Agent Details                                                    |
|  +---------------------------------------------------------+     |
|  | Name*          [QC Inspector                           ] |     |
|  | Description    [Inspects manufacturing quality data    ] |     |
|  |                [and flags anomalies in production      ] |     |
|  |                [batches                                ] |     |
|  | Model          [claude-sonnet-4-20250514           v] |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|  Sandbox Configuration                                            |
|  +---------------------------------------------------------+     |
|  | Coding Agents  [x] Claude  [ ] Codex  [ ] Aider        |     |
|  |                                                         |     |
|  | -- Cloud provider fields (shown for e2b/daytona/docker) |     |
|  | Image          [rivetdev/sandbox-agent:0.4.2-full    ] |     |
|  | Snapshot       [                                     ] |     |
|  |                                                         |     |
|  | (Hidden when workspace uses local provider)             |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|  Environment Variables                                            |
|  +---------------------------------------------------------+     |
|  | QC_API_ENDPOINT    = https://qc.acme-mfg.com/api       |     |
|  | QC_BATCH_THRESHOLD = 0.95                                |     |
|  | [+ Add Variable]                                        |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|  Authority Scopes                                                 |
|  +---------------------------------------------------------+     |
|  | Action                  | Permission Level              |     |
|  |-------------------------|-------------------------------|     |
|  | create_observation      | [auto                    v]  |     |
|  | create_decision         | [propose                 v]  |     |
|  | create_task             | [propose                 v]  |     |
|  | confirm_decision        | [blocked                 v]  |     |
|  | execute_code            | [auto                    v]  |     |
|  |                                                         |     |
|  | Permission levels:                                      |     |
|  |   auto - agent acts independently                       |     |
|  |   propose - agent suggests, human approves              |     |
|  |   blocked - agent cannot perform this action            |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|                              [Cancel]  [<- Back]  [Create Agent]  |
+-------------------------------------------------------------------+
```

### Design Notes

- Required fields marked with asterisk
- Model dropdown populated from workspace configuration
- Sandbox config fields are provider-conditional: all providers show coding agents and env vars; cloud providers (e2b, daytona, docker) additionally show image and snapshot; local provider hides these
- Environment variables use key-value pairs with add/remove
- Authority scopes show every available action with permission dropdown
- Permission level legend visible inline (recognition over recall)
- Sensible defaults: most actions start as "propose" (safe default)

## Step 4: Configure Agent -- External Path

### Emotional State

- Entry: Focused ("I need to register my agent")
- Exit: Ready ("I have what I need to connect")

### Wireframe (External Agent)

```
+------------------------------------------------------------------+
| Create External Agent                                    [x]      |
+------------------------------------------------------------------+
|                                                                   |
|  Agent Details                                                    |
|  +---------------------------------------------------------+     |
|  | Name*          [Compliance Bot                         ] |     |
|  | Description    [Automated compliance auditor that      ] |     |
|  |                [scans transactions for regulatory      ] |     |
|  |                [violations                             ] |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|  Authority Scopes                                                 |
|  +---------------------------------------------------------+     |
|  | Action                  | Permission Level              |     |
|  |-------------------------|-------------------------------|     |
|  | create_observation      | [auto                    v]  |     |
|  | create_decision         | [propose                 v]  |     |
|  | create_task             | [blocked                 v]  |     |
|  | confirm_decision        | [blocked                 v]  |     |
|  |                                                         |     |
|  | Permission levels:                                      |     |
|  |   auto - agent acts independently                       |     |
|  |   propose - agent suggests, human approves              |     |
|  |   blocked - agent cannot perform this action            |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|                              [Cancel]  [<- Back]  [Create Agent]  |
+-------------------------------------------------------------------+
```

### Design Notes

- Simpler form than sandbox (no runtime config needed)
- Authority scopes identical to sandbox path (shared component)
- After creation, a confirmation screen shows the proxy token (see Step 5)

## Step 5: Verification and Deployment

### Emotional State

- Entry: Expectant ("Did it work?")
- Exit: Confident, empowered ("Agent is ready, I know what to do next")

### Wireframe (Post-Creation Confirmation -- External Agent)

```
+------------------------------------------------------------------+
| Agent Created Successfully                               [x]     |
+------------------------------------------------------------------+
|                                                                   |
|  [checkmark icon]  Compliance Bot is ready to connect             |
|                                                                   |
|  +-- What was created ----------------------------------+         |
|  | Agent record          compliance-bot                  |         |
|  | Identity              agent:compliance-bot            |         |
|  | Workspace membership  acme-manufacturing              |         |
|  | Authority scopes      4 configured                    |         |
|  +-------------------------------------------------------+        |
|                                                                   |
|  +-- Proxy Token (shown once) ---------------------------+        |
|  |                                                       |        |
|  |  osp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9      |        |
|  |                                    [Copy to Clipboard] |        |
|  |                                                       |        |
|  |  Use this token in your agent's X-Osabio-Auth header.  |        |
|  |  This token cannot be retrieved after closing this    |        |
|  |  dialog.                                              |        |
|  +-------------------------------------------------------+        |
|                                                                   |
|  +-- Connect your agent --------------------------------+         |
|  |                                                       |        |
|  |  Set the following in your agent's environment:       |        |
|  |                                                       |        |
|  |  OSABIO_SERVER_URL=https://brain.acme-mfg.com          |        |
|  |  OSABIO_AUTH_TOKEN=osp_a1b2c3d4e5f6...              |        |
|  |  OSABIO_WORKSPACE_ID=acme-manufacturing                |        |
|  |                                                       |        |
|  +-------------------------------------------------------+        |
|                                                                   |
|                                     [Go to Agent]  [Close]        |
+-------------------------------------------------------------------+
```

### Wireframe (Post-Creation Confirmation -- Sandbox Agent)

```
+------------------------------------------------------------------+
| Agent Created Successfully                               [x]     |
+------------------------------------------------------------------+
|                                                                   |
|  [checkmark icon]  QC Inspector is ready                          |
|                                                                   |
|  +-- What was created ----------------------------------+         |
|  | Agent record          qc-inspector                    |         |
|  | Identity              agent:qc-inspector              |         |
|  | Workspace membership  acme-manufacturing              |         |
|  | Authority scopes      5 configured                    |         |
|  | Sandbox config        rivetdev/sandbox-agent:0.4.2    |         |
|  +-------------------------------------------------------+        |
|                                                                   |
|  You can now spawn sessions for this agent from the               |
|  agents page.                                                     |
|                                                                   |
|                                     [Go to Agent]  [Close]        |
+-------------------------------------------------------------------+
```

## Step 6: Agent Detail View and Session Monitoring (Sandbox)

### Emotional State

- Entry: Monitoring ("Is my agent working?")
- Exit: In-control ("I can see exactly what is happening")

### Wireframe

```
+------------------------------------------------------------------+
| <- Back to Agents                                                 |
+------------------------------------------------------------------+
|                                                                   |
|  QC Inspector                           sandbox | 2 active        |
|  Inspects manufacturing quality data                              |
|  and flags anomalies in production batches                        |
|                                                                   |
|  [Spawn Session]  [Edit]  [Delete]                                |
|                                                                   |
|  +-- Configuration -----------------------------------------+     |
|  | Agents:   Claude                                          |     |
|  | Model:    claude-sonnet-4-20250514                       |     |
|  | Env vars: QC_API_ENDPOINT, QC_BATCH_THRESHOLD             |     |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  +-- Authority Scopes --------------------------------------+     |
|  | create_observation: auto                                  |     |
|  | create_decision: propose                                  |     |
|  | create_task: propose                                      |     |
|  | confirm_decision: blocked                                 |     |
|  | execute_code: auto                                        |     |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  +-- Sessions -----------------------------------------------+    |
|  |                                                           |    |
|  | Active                                                    |    |
|  | [*] Session #47  spawned 12m ago  task: Batch #2847 QC    |    |
|  |     Status: active | Last event: 2m ago                   |    |
|  | [*] Session #46  spawned 45m ago  task: Batch #2846 QC    |    |
|  |     Status: active | Last event: 5m ago                   |    |
|  |                                                           |    |
|  | Idle                                                      |    |
|  | [ ] Session #45  idle 20m  Awaiting review feedback        |    |
|  |     [Resume] [Send Feedback]                              |    |
|  |                                                           |    |
|  | Completed (last 7 days)                                   |    |
|  | [ ] Session #44  completed 2h ago  Duration: 18m          |    |
|  | [ ] Session #43  completed 5h ago  Duration: 22m          |    |
|  | [ ] Session #42  error 1d ago  "Sandbox timeout"          |    |
|  +-----------------------------------------------------------+    |
+-------------------------------------------------------------------+
```

### Design Notes

- Session list reuses existing `agent_session` table data
- Active sessions show real-time last event timestamp
- Idle sessions have actionable resume/feedback buttons
- Error sessions show error message inline
- Session history collapsible for long lists

## Error Paths

### E1: Agent Name Already Exists

```
+-----------------------------------------------------------+
| Name*  [QC Inspector                                    ] |
|        ! An agent named "QC Inspector" already exists      |
|          in this workspace. Choose a different name.       |
+-----------------------------------------------------------+
```

### E2: Sandbox Provider Not Configured

```
+-----------------------------------------------------------+
| Sandbox Configuration                                      |
|                                                            |
| [!] No sandbox provider configured for this workspace.     |
|     Configure one in Settings > Sandbox Provider before    |
|     creating sandbox agents.                               |
|                                                            |
|     [Go to Settings]                                       |
+-----------------------------------------------------------+
```

### E3: Transactional Creation Failure

```
+-----------------------------------------------------------+
| [!] Agent creation failed                                  |
|                                                            |
|     Could not create the identity records for              |
|     "Compliance Bot". No partial records were saved.       |
|                                                            |
|     This may be a temporary issue. Try again, or           |
|     contact your workspace administrator if the            |
|     problem persists.                                      |
|                                                            |
|     [Try Again]  [Close]                                   |
+-----------------------------------------------------------+
```

### E4: Delete Agent with Active Sessions

```
+-----------------------------------------------------------+
| Delete QC Inspector?                                       |
|                                                            |
| This agent has 2 active sessions. Deleting the agent       |
| will terminate all active sessions and remove:             |
|                                                            |
|   - Agent record and configuration                         |
|   - Agent identity and workspace membership                |
|   - Authority scope assignments                            |
|   - 47 historical session records                          |
|                                                            |
| This action cannot be undone.                              |
|                                                            |
|     [Cancel]  [Delete Agent and Terminate Sessions]        |
+-----------------------------------------------------------+
```

## Integration Checkpoints

1. **Agent record <-> Identity**: After creation, `identity_agent` edge must link identity to agent. Verify via agent detail view showing identity reference.
2. **Identity <-> Workspace**: `member_of` edge must exist. Verify by agent appearing in workspace agent list.
3. **Identity <-> Authority Scopes**: `authorized_to` edges must match configured scopes. Verify via agent detail authority section.
4. **Sandbox Config <-> Workspace Provider**: If runtime=sandbox, workspace must have `settings.sandbox_provider` configured. Validate at creation time.
5. **Session List <-> agent_session table**: Agent detail session list queries `agent_session` WHERE agent matches. Existing data flows unchanged.
