# JTBD Job Stories: OAuth RAR + DPoP (Sovereign Hybrid Model)

## Job 1: Actor Obtaining a Brain Operation Token

### Job Story

**When** any actor (AI agent or human operator) needs to perform ANY operation on the Brain knowledge graph -- whether reading entities, creating tasks, updating decisions, or invoking external integrations,
**I want to** obtain a DPoP-bound access token with a structured `brain_action` authorization_details object describing exactly what I am authorized to do,
**so I can** execute the operation with minimum privilege, maximum auditability, and cryptographic proof that only I -- not an interceptor -- can use this token.

### Functional Dimension

- Generate a DPoP key pair (asymmetric, e.g., ES256) within the actor's runtime (agent sandbox or browser/CLI client)
- Construct an `authorization_details` object as a `brain_action` intent: `{ type: "brain_action", action: "<verb>", resource: "<target>", constraints: {...} }`
- Submit an OAuth token request with RAR payload and DPoP proof header to the Custom Authorization Server
- Receive a DPoP-bound access token with `cnf.jkt` claim (JWK thumbprint)
- Present the token + fresh DPoP proof to the Brain resource server for the specific operation

### Emotional Dimension

- **Start**: Purposeful but constrained -- the actor knows it needs authorization before touching the Brain
- **Middle**: Transparent -- the actor can see exactly what operation it is requesting and whether its request was approved, veto-windowed, or rejected
- **End**: Confident -- the actor holds a token that is narrowly scoped to a structured `brain_action` and cryptographically bound to its key pair; it can proceed knowing the operation is sanctioned

### Social Dimension

- The actor's token request is visible in the audit trail, demonstrating that it did not act unilaterally
- The Authorizer Agent evaluates every request as a Rich Intent Object -- never scopes -- providing uniform, explainable authorization decisions
- Compliance teams can verify that every Brain operation had a corresponding structured `brain_action` token issuance

### Forces Analysis

- **Push**: Today, agents use broad `scope` strings (e.g., `task:write`) that grant access to entire categories of actions. The existing `action_spec` in the intent system captures structured intent, but it is not carried into the OAuth token -- the token and the intent are disconnected authorization layers. Worse, classification of "consequential vs non-consequential" actions is itself a vulnerability -- an attacker who can reclassify an action can bypass authorization entirely.
- **Pull**: RAR eliminates classification as a vulnerability. EVERY Brain operation, from a simple graph read to a financial integration, uses the same structured `brain_action` authorization_details. The Authorizer Agent speaks one language of authority. DPoP ensures the token cannot be replayed even if intercepted.
- **Anxiety**: Will requiring RAR+DPoP for every operation (including reads) add unacceptable latency? Will the added complexity slow down routine agent work?
- **Habit**: Agents currently authenticate with a single long-lived Bearer token per session. The pattern is simple: get token at session start, use it for everything. Switching to per-operation structured tokens is a paradigm shift. Humans are used to session cookies granting full dashboard access.

---

## Job 2: Human Owner Authorizing/Constraining Agent Actions

### Job Story

**When** my AI agent (e.g., the management agent "Atlas") requests a Brain operation token for a high-stakes action like creating a production deployment or issuing a client invoice for $12,000,
**I want to** review the exact structured `brain_action` intent -- not just a vague permission -- and approve, constrain, or reject it within a time-bounded window,
**so I can** maintain meaningful control over consequential actions while trusting the agent to handle routine operations autonomously.

### Functional Dimension

- Receive a notification (in-app, email, or push) when an agent submits an intent that enters `pending_veto` status
- View the full `authorization_details` (action, resource, constraints) in human-readable form
- Approve the intent (transitions to `authorized`, token issued), reject it (transitions to `vetoed`), or let the veto window expire (auto-authorizes if risk is medium)
- Optionally constrain the authorization: reduce the budget cap, narrow the action parameters, add conditions
- See the audit trail of all past authorization decisions for this agent and workspace

### Emotional Dimension

- **Start**: Alert but not alarmed -- the notification communicates "your agent wants to do something significant" without inducing panic
- **Middle**: Informed and empowered -- the human can see the exact structured `brain_action`, the risk score, the Authorizer Agent's reasoning, and make a decision with full context
- **End**: Reassured -- the human knows exactly what they authorized, the decision is logged, and they retain the ability to revoke or constrain future actions

### Social Dimension

- The human is seen by their team and stakeholders as maintaining responsible oversight of AI agents -- not rubber-stamping or ignoring
- The authorization decision is shared -- other workspace members can see what was approved and by whom
- In regulated industries, the human can demonstrate to auditors that every high-value agent action had explicit human authorization with structured evidence

### Forces Analysis

- **Push**: Currently, the consent screen shows generic OAuth scopes like "graph:read, decision:write." For consequential actions, these scopes are meaningless -- they tell the human nothing about WHAT the agent actually wants to do. The human either rubber-stamps (dangerous) or blocks everything (defeats the purpose of autonomous agents).
- **Pull**: RAR-enriched consent shows "Agent Atlas wants to: Create invoice for Acme Corp, amount: $12,000, via Stripe API." The human can make an informed decision. The Authorizer Agent's reasoning is visible. The veto window means medium-risk actions auto-approve unless explicitly vetoed -- reducing consent fatigue for routine operations.
- **Anxiety**: Will I be overwhelmed with authorization requests? What if I miss the veto window and something bad auto-approves? What if the structured description is too technical for me to understand?
- **Habit**: Humans are used to coarse-grained OAuth consent ("This app wants to access your Google Drive"). Switching to per-action structured consent is more work but vastly more meaningful. The existing veto window pattern (30 min) already exists in the intent system.

---

## Job 3: Brain Resource Server Verifying Uniform Authorization

### Job Story

**When** the Brain resource server receives ANY request -- whether from an agent sandbox or a human dashboard client -- bearing an access token and a DPoP proof header,
**I want to** verify that (a) the token is valid and contains a `brain_action` authorization_details covering the requested operation, (b) the presenter is the same entity the token was issued to via JWK thumbprint matching, and (c) the DPoP proof is fresh (not replayed),
**so I can** execute the operation knowing the request is authenticated, authorized for this specific operation, and not a token replay attack -- regardless of whether the caller is human or agent.

### Functional Dimension

- Extract the DPoP proof JWT from the `DPoP` request header
- Validate the DPoP proof: correct HTTP method and URI, `jti` is unique (replay protection), `iat` is within acceptable clock skew window
- Extract the `cnf.jkt` claim from the access token -- this is the JWK thumbprint of the key that should have signed the DPoP proof
- Verify that the DPoP proof's signing key thumbprint matches the access token's `cnf.jkt`
- Check that the access token's `authorization_details` covers the requested operation (action, resource, constraints match)
- If all checks pass, proceed with operation execution; otherwise, return 401/403
- No scope fallback. No Bearer token path to the Brain. Every request requires DPoP + RAR.

### Emotional Dimension

- **Start**: Vigilant -- the resource server treats every incoming request as potentially hostile
- **Middle**: Methodical -- each verification step (token validity, DPoP binding, action scope) is checked in sequence with clear pass/fail
- **End**: Assured -- if all checks pass, the resource server can execute the operation with high confidence that the request is legitimate

### Social Dimension

- Security auditors can verify that the resource server enforces proof-of-possession uniformly -- no scope-only backdoor
- The platform can demonstrate to customers that leaked tokens cannot be exploited -- the private key never leaves the actor's runtime
- In incident response, the `jti` nonce trail provides forensic evidence of every token presentation

### Forces Analysis

- **Push**: Today, the MCP auth layer validates Bearer tokens by checking JWT signature and claims, but any entity holding the token can use it. If a token leaks (logging, debugging, network interception), it can be replayed by an attacker. There is no sender-constraining mechanism. Worse, a tiered system where some actions use scopes and others use RAR creates a classification boundary that is itself a vulnerability.
- **Pull**: Uniform DPoP+RAR verification eliminates classification as an attack surface. Every request, whether a graph read or a financial integration, goes through the same verification pipeline. The Authorizer Agent speaks one language. A stolen session cookie cannot touch the Brain.
- **Anxiety**: Will DPoP verification add latency to every API call? Will clock skew between actor and resource server cause legitimate requests to fail? Will nonce storage for replay protection consume unbounded memory?
- **Habit**: Resource servers currently validate a single Bearer token header. Adding DPoP requires validating a second header (the proof JWT), maintaining a nonce cache, and checking thumbprint binding. The verification logic is more complex but follows a deterministic pipeline.

---

## Job 4: Human Operator Exchanging Session for Brain Token (The Bridge)

### Job Story

**When** I am logged into the Brain dashboard via Better Auth (standard session/scopes) and I need to perform an operation on the knowledge graph -- such as viewing project status, creating a task, or approving an agent's pending authorization,
**I want to** transparently exchange my Better Auth session for a DPoP-bound RAR token from the Custom Authorization Server,
**so I can** access the Brain with the same structured authorization that agents use -- my session cookie alone cannot touch the knowledge graph.

### Functional Dimension

- Human logs into the dashboard via Better Auth (standard session, traditional scopes for UI authentication)
- When the dashboard needs to perform a Brain operation, the client-side code generates a DPoP key pair (or reuses one for the session)
- The client constructs a `brain_action` authorization_details for the requested operation
- The client exchanges the Better Auth session + DPoP proof for a RAR token from the Custom AS
- The Custom AS validates the Better Auth session is still active, then issues a DPoP-bound token with `brain_action` authorization_details
- The client presents the DPoP-bound token to the Brain resource server -- same verification pipeline as agents

### Emotional Dimension

- **Start**: Seamless -- the human does not perceive a "token exchange" step; the dashboard handles it transparently
- **Middle**: Protected -- the human's session cookie cannot directly access the Brain, preventing session hijacking from granting graph access
- **End**: Confident -- the human operates on the Brain with the same structured authorization as agents, with full audit trail

### Social Dimension

- Human parity with agents: Marcus generates a DPoP-signed intent just like an agent. The Brain treats all actors uniformly.
- A stolen session cookie (XSS, CSRF) cannot touch the knowledge graph -- the attacker would also need the DPoP private key held in the browser's memory
- Audit trail shows the same structured `brain_action` records for both human and agent operations

### Forces Analysis

- **Push**: Currently, a Better Auth session cookie grants direct access to the Brain API. If the session is hijacked (XSS, CSRF, cookie theft), the attacker has full access to the knowledge graph. There is no separation between "I am a logged-in human" (authentication) and "I am authorized to perform this Brain operation" (authorization).
- **Pull**: The Bridge separates these concerns cleanly. Better Auth scopes = authentication proof ("I am Marcus"). RAR = authorization proof ("I am authorized to read this project's task list"). A stolen session cookie is worthless without the DPoP key pair in the browser. The Custom AS can enforce additional policies (rate limiting, risk scoring) at the Bridge boundary.
- **Anxiety**: Will the token exchange add perceptible latency to dashboard interactions? Will the user experience feel more complex? What happens if the Better Auth session expires mid-operation?
- **Habit**: Humans are deeply habituated to session cookies granting full access. Every web application they use works this way. The Bridge is invisible in the happy path but represents a fundamental architectural shift. The dashboard must make this seamless.
