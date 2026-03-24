Feature: OpenClaw Agent Connect & Execute via Gateway Protocol

  Background:
    Given Brain is running with gateway endpoint at "/api/gateway"
    And a workspace "acme" exists with configured model providers

  # --- J2: Zero-Config Agent Onboarding ---

  Scenario: Known device connects and resolves identity
    Given a device with fingerprint "dev-abc123" is registered in Brain
    And the device has identity "identity:marcus" with workspace membership
    When the device opens a WebSocket to "/api/gateway"
    And sends a connect frame with its Ed25519 public key
    Then Brain sends a connect.challenge with a nonce
    When the device signs the nonce with its Ed25519 private key
    Then Brain verifies the signature
    And resolves identity "identity:marcus"
    And sends connect.ok with workspace context

  Scenario: New device auto-registers via DCR
    Given a device with fingerprint "dev-new456" is NOT registered in Brain
    When the device opens a WebSocket to "/api/gateway"
    And sends a connect frame with its Ed25519 public key
    And signs the challenge nonce
    Then Brain verifies the signature
    And auto-registers the device via DCR (RFC 7591)
    And creates a Brain identity linked to the device
    And creates a member_of edge to the default workspace
    And sends connect.ok with workspace context and client_id

  Scenario: Device authentication fails
    Given a device with fingerprint "dev-bad789"
    When the device opens a WebSocket to "/api/gateway"
    And sends a connect frame with an Ed25519 public key
    And signs the challenge nonce with a DIFFERENT private key
    Then Brain sends connect.error with code "auth_failed"
    And the WebSocket is closed

  # --- J1: Context-Aware Coding Session ---

  Scenario: Agent submits work with graph context injection
    Given a connected device with identity "identity:marcus" in workspace "acme"
    And the workspace has 3 active decisions and 2 constraints
    And the workspace has 1 active learning for agent type "code_agent"
    When the device sends an agent frame with task "implement rate limiting"
    Then Brain orchestrator loads graph context for the workspace
    And injects the 3 decisions, 2 constraints, and 1 learning into the agent prompt
    And evaluates policies for the intent
    And assigns the task to a session
    And sends agent.accepted with runId and sessionId

  Scenario: Agent work blocked by policy
    Given a connected device with identity "identity:junior-dev" in workspace "acme"
    And the workspace has a policy restricting "code_agent" to max_risk_level "low"
    When the device sends an agent frame with task "delete production database"
    Then Brain evaluates the intent against the policy graph
    And the intent is denied due to risk_level "critical" exceeding "low"
    And sends agent.error with policy violation detail

  Scenario: Agent work blocked by budget
    Given a connected device with identity "identity:marcus" in workspace "acme"
    And the identity has a budget limit of $5.00
    And current spend is $4.80
    When the device sends an agent frame with task "refactor auth module"
    Then Brain checks budget and finds $0.20 remaining
    And sends agent.error with code "budget_exceeded" and spend details

  # --- J5: Real-Time Agent Streaming ---

  Scenario: LLM tokens stream in real time
    Given an active agent session with runId "run-001"
    When the orchestrator receives an agent_token event with delta "Hello"
    Then the gateway sends a WebSocket event to the client:
      | stream    | assistant                    |
      | data      | { "delta": "Hello" }         |
    And the event has seq number incremented from previous

  Scenario: File change streams as lifecycle event
    Given an active agent session with runId "run-001"
    When the orchestrator receives an agent_file_change event for "src/auth.ts"
    Then the gateway sends a WebSocket event to the client:
      | stream    | lifecycle                              |
      | data      | { "phase": "file_change", "path": "src/auth.ts" } |

  Scenario: Exec approval flow
    Given an active agent session with runId "run-001"
    When the agent requests exec approval for "npm install express"
    Then the gateway sends an exec.request event to the client
    When the client sends exec.approve for the request
    Then Brain evaluates the intent via authorizer
    And the agent proceeds with execution

  Scenario: Exec denial flow
    Given an active agent session with runId "run-001"
    When the agent requests exec approval for "rm -rf /"
    Then the gateway sends an exec.request event to the client
    When the client sends exec.deny for the request
    Then the agent receives the denial
    And the agent does NOT execute the command

  # --- Reconnection ---

  Scenario: Client reconnects after disconnect
    Given an active agent session with runId "run-001"
    And the WebSocket disconnects unexpectedly
    Then the agent session continues running server-side
    When the device reconnects and authenticates
    And sends agent.status for runId "run-001"
    Then Brain returns current session state and buffered events
