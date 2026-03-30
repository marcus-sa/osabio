# Journey: Create Agent with Skills

## Persona: Marcus (Workspace Admin)

Technical founder running Osabio. Creates and configures agents for specialized domain tasks (security auditing, code review, compliance checks). Wants agents to have expertise without per-session re-explanation.

## Emotional Arc

```
Start: Intentional        Middle: In Control        End: Confident
"I know what I need"      "This makes sense"        "Agent is ready"
```

## Journey Flow

```
[Trigger: Need a new       [Step 1: Config]         [Step 2: Skills]        [Step 3: Tools]         [Done: Agent Created]
 specialized agent]     ->  Runtime + Identity   ->  Assign Expertise    ->  Review Toolset      ->  Atomic Creation
                            Feels: Focused            Feels: Empowered        Feels: In Control       Feels: Confident
                            "Setting up basics"       "Equipping my agent"    "Everything checks out" "Ready to go"
```

## Step 1: Agent Config

```
+-- Create Agent (Step 1 of 3) ------------------------------------+
|                                                                   |
|  Runtime                                                          |
|  ( ) Sandbox    ( ) External                                      |
|                                                                   |
|  Name                                                             |
|  [security-auditor_________________________]                      |
|                                                                   |
|  Description                                                      |
|  [Performs comprehensive security audits of ____________________] |
|  [code changes before merge. Checks for OWASP___________________]|
|                                                                   |
|  Model                                                            |
|  [claude-sonnet-4-20250514_________________ v]                    |
|                                                                   |
|  Authority Scopes                                                 |
|  +-----------------------------------------------------------+   |
|  | Action         | None | Request | Autonomous |             |   |
|  |----------------|------|---------|------------|             |   |
|  | Create task    |      |   (o)   |            |             |   |
|  | Create decision|      |   (o)   |            |             |   |
|  | Create obs.    |      |         |    (o)     |             |   |
|  +-----------------------------------------------------------+   |
|                                                                   |
|  Sandbox Config (shown when Sandbox selected)                     |
|  Coding Agents: [claude-code_________________ v]                  |
|  Environment Variables: [KEY=VALUE...]                             |
|                                                                   |
|                              [Cancel]  [Next ->]                  |
+-------------------------------------------------------------------+
```

**Emotional state**: Focused, familiar. This is an enhanced version of what they already do.
**Shared artifacts**: `${agent_name}`, `${runtime}`, `${authority_scopes}`

## Step 2: Skills Setup

```
+-- Create Agent (Step 2 of 3) ------------------------------------+
|                                                                   |
|  Assign Skills to "${agent_name}"                                 |
|                                                                   |
|  Select domain expertise for this agent.                          |
|  Skills provide instructions and automatically grant              |
|  required tools.                                                  |
|                                                                   |
|  +-----------------------------------------------------------+   |
|  | [x] security-audit  v1.2                          github   |   |
|  |     Performs comprehensive security audits of code         |   |
|  |     changes. Checks OWASP Top 10, dependency vulns.       |   |
|  +-----------------------------------------------------------+   |
|  | [x] code-review  v2.0                             github   |   |
|  |     Reviews code for quality, maintainability, and         |   |
|  |     adherence to team conventions.                         |   |
|  +-----------------------------------------------------------+   |
|  | [ ] database-migration  v1.0                      git      |   |
|  |     Guides safe database schema migrations with            |   |
|  |     rollback plans and data validation.                    |   |
|  +-----------------------------------------------------------+   |
|  | [ ] api-design  v1.1                              github   |   |
|  |     Designs REST and GraphQL APIs following OpenAPI        |   |
|  |     standards and versioning best practices.               |   |
|  +-----------------------------------------------------------+   |
|                                                                   |
|  2 skills selected                                                |
|                                                                   |
|                    [<- Back]  [Skip]  [Next ->]                   |
+-------------------------------------------------------------------+
```

**Emotional state**: Empowered. "I'm giving my agent real expertise."
**Shared artifacts**: `${selected_skills}`, `${skill_count}`
**Key interaction**: Checking a skill updates the count badge. Unchecking removes it.

## Step 3: Tools Review

```
+-- Create Agent (Step 3 of 3) ------------------------------------+
|                                                                   |
|  Tools for "${agent_name}"                                        |
|                                                                   |
|  SKILL-DERIVED TOOLS (automatic)                                  |
|  These tools are granted by the skills you assigned.              |
|  +-----------------------------------------------------------+   |
|  |  read_file           via security-audit                    |   |
|  |  search_codebase     via security-audit, code-review       |   |
|  |  run_linter          via code-review                       |   |
|  |  check_dependencies  via security-audit                    |   |
|  +-----------------------------------------------------------+   |
|                                                                   |
|  ADDITIONAL TOOLS (manual)                                        |
|  Select extra tools beyond what skills provide.                   |
|  +-----------------------------------------------------------+   |
|  | [x] create_branch                                          |   |
|  | [ ] merge_pr                                               |   |
|  | [x] post_comment                                           |   |
|  | [ ] deploy_staging                                         |   |
|  +-----------------------------------------------------------+   |
|                                                                   |
|  Total effective tools: 6                                         |
|  (4 from skills + 2 additional)                                   |
|                                                                   |
|                    [<- Back]  [Skip]  [Create Agent]              |
+-------------------------------------------------------------------+
```

**Emotional state**: In control. "I can see exactly what this agent can do."
**Shared artifacts**: `${skill_derived_tools}`, `${additional_tools}`, `${total_tools}`
**Key interaction**: Skill-derived section is read-only with "via skill X" labels. Additional section is an editable checklist.

## Step 4: Success Confirmation

```
+-- Agent Created --------------------------------------------------+
|                                                                   |
|  Agent "security-auditor" created successfully.                   |
|                                                                   |
|  Runtime:  Sandbox                                                |
|  Skills:   2 (security-audit, code-review)                        |
|  Tools:    6 (4 skill-derived + 2 additional)                     |
|                                                                   |
|                              [View Agent]  [Create Another]       |
+-------------------------------------------------------------------+
```

**Emotional state**: Confident, satisfied. "My agent is equipped and ready."

## Error Paths

### No skills exist in workspace
Step 2 shows an empty state: "No skills in this workspace yet. Create skills in the Skill Library to assign them to agents." with a link to skill library. Skip button is prominent.

### Agent name already taken
Step 1 shows inline validation on the name field when blurred: "An agent named 'security-auditor' already exists."

### Skill becomes deprecated between step 2 and step 3
Edge case. At creation time (step 3 submit), the transaction validates all selected skills are still active. If any are deprecated, show error: "Skill 'security-audit' was deprecated since you started. Please go back and update your selection."

### External agent path
Steps 2 and 3 are shown with a muted banner: "Skills and skill-derived tools are only used by sandbox agents. You can still select additional tools." Skip button is the primary action.
