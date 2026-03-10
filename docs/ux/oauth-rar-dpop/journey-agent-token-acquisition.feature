Feature: Actor Token Acquisition with RAR and DPoP (Sovereign Hybrid Model)
  As any actor (agent or human) performing Brain operations,
  I need to obtain DPoP-bound access tokens with brain_action authorization_details
  so that every Brain operation has structured, auditable, sender-constrained authorization.

  Background:
    Given agent "Kira" (code_agent) is running in workspace "Lusaka"
    And "Kira" has an active E2B sandbox with an ES256 DPoP key pair
    And workspace "Lusaka" is owned by Marcus Santos
    And workspace "Lusaka" has a budget cap of $5,000 USD
    And the Custom Authorization Server evaluates Rich Intent Objects only (never scopes)
    And the Brain resource server accepts DPoP+RAR tokens only (no Bearer, no scopes)

  # --- Job 1: Agent obtains token for low-risk Brain read (auto-approve) ---

  Scenario: Agent obtains token for a low-risk graph read operation
    Given agent "Kira" needs to read project graph data in workspace "Lusaka"
    And the brain_action is:
      | type         | action | resource        | constraints                        |
      | brain_action | read   | knowledge_graph | project: "Lusaka", depth: 2        |
    When "Kira" submits the intent with the brain_action and DPoP JWK thumbprint
    Then the Authorizer Agent evaluates the Rich Intent Object
    And the risk router selects route "auto_approve" (read operation, risk_score 10)
    And the intent status transitions to "authorized"
    When "Kira" requests a DPoP-bound access token with authorization_details matching the brain_action
    Then the Custom AS issues a token with:
      | claim                    | value                                         |
      | token_type               | DPoP                                          |
      | cnf.jkt                  | matching Kira's DPoP JWK thumbprint           |
      | authorization_details[0] | type: brain_action, action: read, resource: knowledge_graph |
      | expires_in               | 300                                           |

  # --- Job 1: Agent obtains token for medium-risk operation (veto window) ---

  Scenario: Agent obtains token after veto window expires without human intervention
    Given agent "Kira" needs to create a Stripe invoice for Acme Corp
    And the brain_action is:
      | type         | action | resource | constraints                                       |
      | brain_action | create | invoice  | provider: stripe, customer: cus_acme_corp, amount: 240000 |
    When "Kira" submits the intent with budget_limit $2,400 USD
    Then the Authorizer Agent returns risk_score 45 with decision "APPROVE"
    And the risk router selects route "veto_window" with 30-minute expiry
    And the intent status transitions to "pending_veto"
    And Marcus Santos receives a notification with the structured brain_action
    When 30 minutes elapse without Marcus taking action
    Then the intent status transitions to "authorized"
    And "Kira" can request a DPoP-bound access token

  # --- Job 2: Human approves agent authorization ---

  Scenario: Human approves agent authorization request during veto window
    Given agent "Kira" has submitted an intent to create a Stripe invoice ($2,400, Acme Corp)
    And the intent is in "pending_veto" status with risk_score 45
    When Marcus Santos opens the consent notification
    Then Marcus sees the brain_action in human-readable form:
      | field       | value                                    |
      | Operation   | Create Invoice                           |
      | Resource    | Stripe Integration                       |
      | Customer    | Acme Corp (cus_acme_corp)                |
      | Amount      | $2,400.00 USD                            |
      | Description | Q1 2026 consulting - Project Lusaka      |
      | Risk Score  | 45/100 (medium)                          |
    When Marcus clicks "Approve"
    Then the intent status transitions to "authorized"
    And "Kira" can request a DPoP-bound access token
    And the approval is recorded in the audit trail with Marcus's identity

  # --- Job 2: Human constrains authorization ---

  Scenario: Human constrains agent authorization by reducing budget
    Given agent "Kira" has submitted an intent for Stripe invoice creation with amount $2,400
    And the intent is in "pending_veto" status
    When Marcus Santos opens the consent notification and clicks "Constrain..."
    And Marcus sets the maximum amount to $2,000
    And Marcus clicks "Approve with constraints"
    Then the intent authorization_details are updated with amount cap $2,000
    And the intent status transitions to "authorized"
    And the issued token's authorization_details reflect the constrained amount

  # --- Job 2: Human vetoes ---

  Scenario: Human vetoes agent authorization request
    Given agent "Kira" has submitted an intent for Stripe invoice creation
    And the intent is in "pending_veto" status
    When Marcus Santos clicks "Veto" with reason "Amount too high for new customer relationship"
    Then the intent status transitions to "vetoed"
    And the veto reason is recorded: "Amount too high for new customer relationship"
    And "Kira" receives an error response with the veto reason
    And no access token can be issued for this intent

  # --- Job 4: Human exchanges session for Brain token (The Bridge) ---

  Scenario: Human operator exchanges Better Auth session for Brain read token
    Given Marcus Santos is logged into the dashboard via Better Auth
    And Marcus has a valid session with scope "dashboard:access"
    And the dashboard client has generated an ES256 DPoP key pair
    When Marcus clicks "View Project Lusaka" in the dashboard
    Then the dashboard client constructs a brain_action:
      | type         | action | resource        | constraints                 |
      | brain_action | read   | knowledge_graph | project: "Lusaka", depth: 2 |
    And the dashboard client sends a Bridge exchange request to the Custom AS
    And the Custom AS validates Marcus's Better Auth session is active
    And the Authorizer Agent evaluates the brain_action (auto-approve for reads)
    And the Custom AS issues a DPoP-bound token with brain_action authorization_details
    When the dashboard presents the token to the Brain resource server
    Then the Brain verifies DPoP proof + cnf.jkt + authorization_details
    And Marcus's request is processed identically to an agent request

  # --- Job 4: Session cookie rejected at Brain boundary ---

  Scenario: Better Auth session cookie cannot directly access Brain
    Given Marcus Santos has a valid Better Auth session cookie
    When the dashboard sends a request directly to the Brain with only the session cookie
    Then the Brain resource server rejects with 401 "dpop_required"
    And the error states "Brain operations require DPoP-bound RAR tokens"
    And no scope-based authorization is attempted
    And no Bearer token fallback is available

  # --- Job 4: Bridge rejects expired session ---

  Scenario: Bridge token exchange fails when Better Auth session expires
    Given Marcus Santos had a valid Better Auth session
    And the session has expired due to inactivity
    When the dashboard client attempts a Bridge exchange request
    Then the Custom AS calls Better Auth and finds the session expired
    And the Custom AS rejects with 401 "session_expired"
    And the dashboard redirects Marcus to the Better Auth login page

  # --- Job 1: Key pair reuse across operations ---

  Scenario: Agent reuses existing session key pair for subsequent token requests
    Given agent "Kira" has already generated a DPoP key pair for this session
    And "Kira" previously obtained a token for a graph read using the same key pair
    When "Kira" submits a new intent for a different Brain operation
    Then "Kira" reuses the existing DPoP key pair (no new key generation)
    And the new intent includes the same dpop_jwk_thumbprint
    And the new token's cnf.jkt matches the same key pair

  # --- Error: Policy gate rejection ---

  Scenario: Intent rejected by policy gate due to budget cap
    Given workspace "Lusaka" has a budget cap of $5,000 USD
    And agent "Kira" submits an intent with budget_limit $7,500 USD
    When the policy gate evaluates the intent
    Then the intent is rejected with reason "Intent budget $7,500 USD exceeds workspace budget cap of $5,000 USD"
    And the intent status transitions to "vetoed"
    And no token is issued

  # --- Error: DPoP key mismatch ---

  Scenario: Token request rejected due to DPoP key mismatch
    Given agent "Kira" submitted an intent with dpop_jwk_thumbprint "thumb-AAA"
    And the intent status is "authorized"
    When "Kira" requests a token but the DPoP proof is signed with a different key (thumbprint "thumb-BBB")
    Then the Custom AS rejects with 401 "dpop_key_mismatch"
    And the error detail states "DPoP proof signed by different key than registered with intent"

  # --- Error: Token expired before use ---

  Scenario: Actor re-requests token after expiry
    Given agent "Kira" obtained a DPoP-bound token with 300-second TTL
    And the token expired before "Kira" could execute the operation
    When "Kira" requests a new token for the same authorized intent
    Then the Custom AS issues a new DPoP-bound token
    And the new token has a fresh 300-second TTL
    And the new DPoP proof uses a fresh jti nonce

  # --- Error: Authorizer Agent timeout ---

  Scenario: Authorizer Agent timeout falls back to veto window
    Given agent "Kira" submits an intent for a Brain operation
    When the Authorizer Agent times out after 30 seconds
    Then the system falls back to APPROVE with risk_score 50 and policy_only true
    And the risk router selects route "veto_window" (score 50 > threshold 30)
    And the intent enters "pending_veto" for human review
    And the evaluation reason states "Authorizer Agent timeout -- falling back to policy-only with veto window"

  # --- Property: Token binding invariant ---

  @property
  Scenario: DPoP-bound tokens cannot be used without the matching private key
    Given a DPoP-bound access token has been issued with cnf.jkt "thumb-AAA"
    When any entity presents the token without a valid DPoP proof signed by key "thumb-AAA"
    Then the Brain resource server rejects the request with 401
    And no operation is executed regardless of token validity

  # --- Property: Uniform authorization ---

  @property
  Scenario: Every Brain operation requires brain_action authorization_details
    Given any actor (agent or human) attempts a Brain operation
    When the actor presents a token without authorization_details containing a brain_action
    Then the Brain resource server rejects the request
    And no scope-based fallback is attempted
    And no Bearer token path is available

  # --- Property: Human parity ---

  @property
  Scenario: Human and agent tokens are verified identically at Brain boundary
    Given a DPoP-bound token issued to agent "Kira" for a brain_action
    And a DPoP-bound token issued to human "Marcus" for the same brain_action
    When both tokens are presented to the Brain resource server with valid DPoP proofs
    Then the same verification pipeline runs for both tokens
    And no distinction is made between human and agent tokens at the Brain boundary
