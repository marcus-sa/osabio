Feature: Unified Identity Audit Trail
  As a workspace owner managing human-agent collaboration,
  I need every action in the knowledge graph attributed to a specific identity
  with a clear accountability chain to a responsible human,
  so I can evaluate AI ROI and answer "who did this?" for any entity.

  Background:
    Given workspace "san-jose" exists
    And identity "Marcus Oliveira" exists with type "human" and role "owner"
    And person spoke for "Marcus Oliveira" has contact_email "marcus@conductor.dev"
    And identity "PM Agent" exists with type "agent" and role "management"
    And agent spoke for "PM Agent" has agent_type "management" and managed_by "Marcus Oliveira"
    And identity "Code Agent" exists with type "agent" and role "coder"
    And agent spoke for "Code Agent" has agent_type "code_agent" and managed_by "Marcus Oliveira"

  # --- Step 1: Schema Bootstrap ---

  Scenario: Identity hub table accepts human and agent types
    When a new identity record is created with name "Ana Torres" and type "human"
    Then the identity record is persisted with type "human"
    And the identity record has a workspace reference
    And the identity record has a created_at timestamp

  Scenario: Identity hub table rejects invalid type
    When a new identity record is created with name "Ghost" and type "bot"
    Then the creation fails with a schema validation error
    And the error indicates type must be "human" or "agent"

  Scenario: Agent spoke table requires managed_by reference
    When a new agent spoke record is created with agent_type "coder" and no managed_by field
    Then the creation fails with a schema validation error
    And the error indicates managed_by is a required field of type record<identity>

  # --- Step 2: Identity Wrapping ---

  Scenario: Existing person gets wrapped in identity hub
    Given person "Marcus Oliveira" exists with contact_email "marcus@conductor.dev"
    When the identity wrapping process runs
    Then an identity record exists with name "Marcus Oliveira" and type "human"
    And an identity_person edge connects the identity to person "Marcus Oliveira"
    And the person record retains contact_email and image fields unchanged

  Scenario: Template agent identity created during workspace bootstrap
    Given workspace "san-jose" is being bootstrapped
    When the agent identity registration runs
    Then identity "PM Agent" exists with type "agent" and role "management"
    And an identity_agent edge connects to an agent spoke record
    And the agent spoke has managed_by pointing to "Marcus Oliveira" identity
    And identity "Code Agent" exists with type "agent" and role "coder"

  Scenario: Agent managed_by chain resolves to human
    Given identity "PM Agent" has agent spoke with managed_by "Marcus Oliveira"
    When the accountability chain is traversed from "PM Agent"
    Then the chain terminates at identity "Marcus Oliveira" with type "human"
    And the traversal depth is 1 hop

  # --- Step 3: Edge Migration ---

  Scenario: Task ownership points at identity instead of person
    Given task "Implement OAuth flow" was owned by person "Marcus Oliveira"
    When the edge migration runs
    Then task "Implement OAuth flow" has owner pointing to identity "Marcus Oliveira"
    And the owner field type is record<identity>

  Scenario: Agent-created task has agent identity as owner
    Given the PM Agent creates task "Set up CI pipeline" during a session
    When the task is persisted
    Then task "Set up CI pipeline" has owner pointing to identity "PM Agent"
    And identity "PM Agent" has type "agent"

  Scenario: Decision attribution supports both human and agent actors
    Given decision "Use hub-and-spoke identity model" exists
    And it was proposed by identity "PM Agent"
    And confirmed by identity "Marcus Oliveira"
    When the decision detail is queried
    Then decided_by shows identity "PM Agent" with type "agent"
    And confirmed_by shows identity "Marcus Oliveira" with type "human"

  Scenario: member_of relation connects identity to workspace
    Given identity "Marcus Oliveira" exists with type "human"
    When the workspace membership is queried
    Then a member_of edge connects identity "Marcus Oliveira" to workspace "san-jose"
    And the edge relation table constraint is IN identity OUT workspace

  # --- Step 4: Auth Rewiring ---

  Scenario: OAuth login resolves to identity record
    Given person "Marcus Oliveira" has OAuth account with provider "github"
    And identity "Marcus Oliveira" wraps person "Marcus Oliveira"
    When Marcus authenticates via GitHub OAuth
    Then the session is created with identity_id pointing to identity "Marcus Oliveira"
    And the session does not reference person directly

  Scenario: Session lookup returns identity with type context
    Given Marcus has an active session
    When the session is looked up by token
    Then the result includes identity_id pointing to identity "Marcus Oliveira"
    And the identity type is "human"
    And person-specific fields are accessible via the identity_person spoke edge

  Scenario: Chat ingress identifies user via identity
    Given Marcus sends a chat message in workspace "san-jose"
    When the chat ingress handler resolves the user
    Then the resolved actor is identity "Marcus Oliveira"
    And the chat context includes identity type "human" and humanPresent true

  # --- Step 5: Authority Migration ---

  Scenario: Role-based permission check for agent identity
    Given identity "PM Agent" has role "management"
    And authority_scope grants role "management" permission "auto" for action "create_task"
    When the PM Agent attempts to create a task
    Then checkAuthority returns permission "auto"

  Scenario: Per-identity override elevates permission
    Given identity "Lead Coder" has role "coder"
    And authority_scope grants role "coder" permission "provisional" for action "confirm_decision"
    And an authorized_to override edge grants identity "Lead Coder" permission "auto" for "confirm_decision"
    When "Lead Coder" attempts to confirm a decision
    Then checkAuthority returns permission "auto" from the override
    And the override takes precedence over the role default

  Scenario: Missing role and no override defaults to blocked
    Given identity "Unknown Agent" has no role assigned
    And no authorized_to override edges exist for "Unknown Agent"
    When "Unknown Agent" attempts to create an observation
    Then checkAuthority returns permission "blocked"

  Scenario: Human identity bypasses authority checks
    Given identity "Marcus Oliveira" has type "human"
    And Marcus is present in the chat session (humanPresent = true)
    When Marcus attempts any action
    Then authority check is bypassed
    And permission "auto" is returned without querying authority_scope

  # --- Step 6: Audit Query ---

  Scenario: Query agent suggestions that became implemented tasks
    Given the PM Agent created suggestion "Prioritize auth feature" 30 days ago
    And Marcus accepted the suggestion, creating task "Implement OAuth flow"
    And task "Implement OAuth flow" has status "done"
    And the Code Agent created suggestion "Add rate limiting" 20 days ago
    And Marcus accepted the suggestion, creating task "Add API rate limiting"
    And task "Add API rate limiting" has status "in_progress"
    When Marcus queries "suggestions made by agents that were actually implemented"
    Then the results include:
      | suggestion           | suggested_by | accountable_human | task                  | status      |
      | Prioritize auth      | PM Agent     | Marcus Oliveira   | Implement OAuth flow  | done        |
      | Add rate limiting    | Code Agent   | Marcus Oliveira   | Add API rate limiting | in_progress |
    And each result shows dual-label attribution (actor + accountable human)

  Scenario: Audit trail shows complete actor history for a task
    Given task "Implement OAuth flow" was:
      | action          | actor          | type   |
      | created         | PM Agent       | agent  |
      | assigned        | Marcus Oliveira| human  |
      | status_changed  | Code Agent     | agent  |
      | completed       | Marcus Oliveira| human  |
    When Marcus queries the full audit trail for task "Implement OAuth flow"
    Then all 4 actions are listed with identity attribution
    And each agent action shows managed_by "Marcus Oliveira"
    And no actions have unattributed actors

  @property
  Scenario: No unattributed actions exist in the graph
    Given the unified identity migration has completed
    Then every task has an owner of type record<identity>
    And every decision has decided_by of type record<identity> or NONE with extraction_confidence below threshold
    And every owns relation edge originates from an identity record
    And every member_of relation edge originates from an identity record
