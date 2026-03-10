Feature: Brain Resource Server DPoP and RAR Verification (Sovereign Hybrid Model)
  As the Brain resource server receiving ALL requests,
  I need to verify DPoP proof-of-possession and brain_action authorization_details
  so that every Brain operation is uniformly authorized -- no scope fallback, no Bearer path,
  and human/agent tokens are verified identically.

  Background:
    Given the Brain resource server has access to the Custom AS JWKS
    And the Brain resource server maintains a time-windowed nonce cache for DPoP replay protection
    And the acceptable clock skew window is 60 seconds past and 5 seconds future
    And the Brain does NOT accept Bearer tokens, session cookies, or scope-only tokens
    And the Brain verifies agent and human tokens with the same pipeline

  # --- Happy Path: Agent request with full DPoP + RAR verification ---

  Scenario: Valid agent DPoP-bound request passes all verification steps
    Given agent "Kira" holds a DPoP-bound access token with:
      | claim                    | value                                       |
      | sub                      | identity:kira-agent-001                     |
      | cnf.jkt                  | NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs |
      | urn:brain:workspace      | lusaka-ws-001                               |
      | urn:brain:intent_id      | abc123                                      |
      | authorization_details[0] | type: brain_action, action: create, resource: invoice, constraints: { provider: stripe, customer: cus_acme_corp, amount: 240000 } |
    And "Kira" constructs a fresh DPoP proof JWT with:
      | field | value                                          |
      | typ   | dpop+jwt                                       |
      | alg   | ES256                                          |
      | jwk   | Kira's public key (thumbprint: NzbLsXh8uD...)  |
      | htm   | POST                                           |
      | htu   | https://brain.example/api/brain/integrations/stripe/invoices |
      | iat   | current timestamp                              |
      | jti   | unique-nonce-001                               |
    When "Kira" sends POST /api/brain/integrations/stripe/invoices with:
      | header        | value                     |
      | Authorization | DPoP <access_token>       |
      | DPoP          | <dpop_proof>              |
    Then the Brain validates the access token signature via JWKS
    And the Brain confirms authorization_details contains type "brain_action"
    And the Brain validates the DPoP proof structure and signature
    And the Brain confirms htm "POST" matches the request method
    And the Brain confirms htu matches the request URI
    And the Brain confirms iat is within the clock skew window
    And the Brain confirms jti "unique-nonce-001" is not in the nonce cache
    And the Brain computes the DPoP proof JWK thumbprint as "NzbLsXh8uD..."
    And the computed thumbprint matches the access token cnf.jkt
    And the Brain matches the requested operation against brain_action authorization_details
    And the operation is executed successfully
    And the intent status is updated to "completed"

  # --- Happy Path: Human request via Bridge (identical verification) ---

  Scenario: Valid human DPoP-bound request via Bridge passes same verification
    Given human "Marcus" obtained a DPoP-bound token via the Bridge with:
      | claim                    | value                                       |
      | sub                      | identity:marcus-human-001                   |
      | cnf.jkt                  | BrowserKey-abc123-thumbprint                |
      | urn:brain:workspace      | lusaka-ws-001                               |
      | authorization_details[0] | type: brain_action, action: read, resource: knowledge_graph, constraints: { project: lusaka, depth: 2 } |
    And Marcus's dashboard constructs a fresh DPoP proof signed with the browser key pair
    When the dashboard sends GET /api/brain/projects/lusaka/graph with:
      | header        | value                     |
      | Authorization | DPoP <access_token>       |
      | DPoP          | <dpop_proof>              |
    Then the Brain runs the SAME verification pipeline as for agent requests
    And the Brain validates brain_action authorization_details
    And the Brain verifies DPoP proof and sender binding
    And the request is processed successfully

  # --- Replay attack detected ---

  Scenario: DPoP proof reuse is rejected as replay attack
    Given any actor holds a valid DPoP-bound access token
    And the actor constructs a DPoP proof with jti "nonce-replay-test"
    And the Brain has already seen jti "nonce-replay-test" in the nonce cache
    When the actor sends the request with the reused DPoP proof
    Then the Brain rejects with 401
    And the error is "dpop_proof_reused"
    And the detail states "DPoP proof nonce has already been used"

  # --- Stolen token detection ---

  Scenario: Stolen token presented with wrong DPoP key is rejected
    Given agent "Kira" holds a DPoP-bound access token with cnf.jkt "thumb-AAA"
    And an attacker "Eve" has intercepted the access token
    And "Eve" constructs a DPoP proof signed with her own key (thumbprint "thumb-BBB")
    When "Eve" sends the request with Kira's token and Eve's DPoP proof
    Then the Brain computes the DPoP proof JWK thumbprint as "thumb-BBB"
    And "thumb-BBB" does not match the access token cnf.jkt "thumb-AAA"
    And the Brain rejects with 401
    And the error is "dpop_binding_mismatch"
    And a security event is logged with both thumbprints for forensic analysis

  # --- Operation scope mismatch ---

  Scenario: Token for invoice creation cannot be used for invoice deletion
    Given agent "Kira" holds a DPoP-bound access token with authorization_details:
      | type         | action | resource |
      | brain_action | create | invoice  |
    And "Kira" constructs a valid DPoP proof for DELETE /api/brain/integrations/stripe/invoices/inv_123
    When "Kira" sends DELETE /api/brain/integrations/stripe/invoices/inv_123
    Then the Brain extracts the requested operation as brain_action: delete invoice
    And the Brain finds no matching entry in authorization_details
    And the Brain rejects with 403
    And the error is "authorization_details_mismatch"

  # --- Human-constrained parameter enforcement ---

  Scenario: Request exceeding human-constrained amount cap is rejected
    Given Marcus Santos constrained Kira's invoice authorization to max amount $2,000
    And the access token authorization_details includes constraints.amount cap 200000
    And "Kira" constructs a valid DPoP proof
    When "Kira" sends POST with request body amount 240000 ($2,400)
    Then the Brain compares requested amount 240000 against authorized cap 200000
    And the Brain rejects with 403
    And the error is "authorization_params_exceeded"
    And the detail states "Requested amount 240000 exceeds authorized cap 200000"

  # --- Bearer token rejected at Brain boundary ---

  Scenario: Bearer token rejected at Brain boundary
    Given any actor holds a Bearer token (with or without cnf.jkt)
    When the actor sends a request with "Authorization: Bearer <token>"
    Then the Brain rejects with 401
    And the error is "dpop_required"
    And the detail states "Brain does not accept Bearer tokens. All operations require DPoP-bound tokens with brain_action authorization_details."

  # --- Session cookie rejected at Brain boundary ---

  Scenario: Session cookie rejected at Brain boundary
    Given human "Marcus" has a valid Better Auth session cookie
    When the dashboard sends a request to the Brain with only the session cookie (no Authorization header)
    Then the Brain rejects with 401
    And the error is "dpop_required"
    And the detail states "Brain operations require DPoP-bound RAR tokens. Use the Bridge to exchange your session."

  # --- Missing DPoP header ---

  Scenario: DPoP-bound token presented without DPoP proof header
    Given any actor holds a DPoP-bound access token
    When the actor sends the request with "Authorization: DPoP <token>" but no DPoP header
    Then the Brain rejects with 401
    And the error is "missing_dpop_proof"
    And the detail states "DPoP-bound token requires DPoP proof header"

  # --- Clock skew ---

  Scenario: DPoP proof with excessive clock skew is rejected
    Given any actor constructs a DPoP proof with iat 90 seconds in the past
    And the acceptable window is 60 seconds past
    When the actor sends the request with the stale DPoP proof
    Then the Brain rejects with 401
    And the error is "dpop_proof_expired"
    And the detail suggests clock synchronization via NTP

  # --- Missing authorization_details ---

  Scenario: Token without brain_action authorization_details is rejected
    Given any actor holds a token that does not contain authorization_details
    When the actor sends the request with "Authorization: DPoP <token>" and a valid DPoP proof
    Then the Brain rejects with 401
    And the error is "missing_authorization_details"
    And the detail states "Brain tokens must contain brain_action authorization_details. No scope fallback."

  # --- Property: Sender binding is unforgeable ---

  @property
  Scenario: Only the holder of the original private key can present a DPoP-bound token
    Given a DPoP-bound access token with cnf.jkt bound to a specific ES256 key pair
    When any entity without the matching private key attempts to construct a valid DPoP proof
    Then the DPoP proof signature verification fails
    And the request is rejected regardless of access token validity

  # --- Property: Each DPoP proof is single-use ---

  @property
  Scenario: No DPoP proof jti can be accepted twice within the nonce window
    Given the nonce cache retains jti values for the duration of the clock skew window
    When a DPoP proof with a previously-seen jti is presented
    Then the request is rejected with "dpop_proof_reused"
    And no operation is executed

  # --- Property: Brain speaks one language ---

  @property
  Scenario: The Brain only accepts brain_action authorization_details
    Given any token presented to the Brain resource server
    When the token contains scope claims but no authorization_details with type "brain_action"
    Then the request is rejected
    And no scope-based authorization is attempted

  # --- Property: Human-agent parity ---

  @property
  Scenario: Human and agent tokens are indistinguishable at Brain boundary
    Given a DPoP-bound token issued to an agent
    And a DPoP-bound token issued to a human via the Bridge
    When both tokens are presented with valid DPoP proofs for the same brain_action
    Then the same verification pipeline runs for both
    And the Brain does not differentiate based on actor type
