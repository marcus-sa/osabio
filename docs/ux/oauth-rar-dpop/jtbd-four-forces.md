# Four Forces Analysis: OAuth RAR + DPoP (Sovereign Hybrid Model)

## Job 1: Actor Obtaining a Brain Operation Token

### Demand-Generating

- **Push** (frustration with current state):
  - Agents use broad OAuth scopes (`task:write`, `decision:write`) that grant access to entire categories without distinguishing a $50 task from a $50,000 invoice
  - The intent system's `action_spec` captures structured authorization details, but these are NOT carried into the OAuth access token -- creating two disconnected authorization layers
  - If a Bearer token leaks (via logs, debug output, or network interception), any holder can replay it -- no sender-constraining mechanism exists
  - Long-lived session tokens violate least-privilege: an agent that needs to create one invoice holds a token that can create unlimited invoices for the entire session
  - **Classification is a vulnerability**: any system that distinguishes "consequential" from "non-consequential" actions creates a boundary an attacker can exploit by reclassifying actions

- **Pull** (attraction of new solution):
  - RAR eliminates the classification boundary: EVERY Brain operation, from a graph read to a financial integration, uses the same structured `brain_action` authorization_details
  - The Authorizer Agent speaks one language of authority -- Rich Intent Objects, never scopes -- providing uniform, explainable decisions
  - DPoP key pairs generated inside the actor's runtime ensure the token is worthless without the private key -- even if the token appears in logs, it cannot be replayed
  - Per-operation structured tokens mean the actor holds exactly the privilege it needs for exactly one operation
  - The `authorization_details` in the token is machine-readable -- the Brain resource server enforces fine-grained access control uniformly

### Demand-Reducing

- **Anxiety** (fears about new approach):
  - DPoP key pair generation and management adds complexity to every actor's runtime -- agents, browsers, and CLI tools all need key management
  - Requiring RAR+DPoP for ALL operations (including reads) adds network round-trips -- will this introduce unacceptable latency for routine graph queries?
  - If the DPoP private key is lost (sandbox crash, browser tab close, process restart), all in-flight tokens become unusable
  - Debugging DPoP failures is harder than debugging Bearer token failures -- "my token was rejected" now has multiple possible causes (expired proof, wrong thumbprint, clock skew, nonce replay)

- **Habit** (inertia of current approach):
  - Agents currently get one Bearer token at session start and use it for everything -- simple, fast, well-understood
  - **Humans are deeply habituated to session cookies granting full access** -- every web application works this way. The idea that a logged-in session cannot touch the Brain is alien.
  - The existing `authenticateMcpRequest` function validates tokens in ~5 lines of logic -- developers know how it works
  - The current scope-based system (`graph:read`, `task:write`) maps cleanly to existing infrastructure -- changing to uniform RAR requires rethinking every authorization check
  - Teams have built years of muscle memory around "Bearer token + scopes" as the standard OAuth pattern

### Assessment

- **Switch likelihood**: HIGH -- the gap between intent-level authorization (structured `action_spec`) and token-level authorization (vague scopes) is a known architectural debt. The elimination of classification as a vulnerability is a strong differentiator. The push is amplified by the realization that tiering creates two systems to maintain and two attack surfaces.
- **Key blocker**: Habit -- specifically, human operators' deep expectation that a logged-in session grants full access. The Bridge must be invisible. Latency anxiety for read-heavy workloads must be mitigated with token batching or short-lived session-scoped RAR tokens for common read patterns.
- **Key enabler**: The existing `action_spec` type is ALREADY structured as a proto-RAR payload (`{ provider, action, params }`) -- the translation to `brain_action` authorization_details is nearly mechanical. The Custom AS can batch-issue tokens for common operation sets.
- **Design implication**: DPoP key lifecycle must be invisible to the developer. Key generation, proof construction, and thumbprint binding should be handled by thin client libraries -- the agent calls `requestBrainToken(brainAction)` and gets back a token + proof generator. The dashboard does this transparently.

---

## Job 2: Human Owner Authorizing/Constraining Agent Actions

### Demand-Generating

- **Push**:
  - The current OAuth consent screen shows scopes like "graph:read, decision:write" -- meaningless for consequential actions. The human cannot distinguish "agent wants to read a project summary" from "agent wants to delete all project data" because both fall under broad scope categories.
  - Consent fatigue: the human either approves everything (security risk) or blocks everything (defeats the purpose of autonomous agents). There is no middle ground for "approve this specific action at this specific scale."
  - The existing veto window (30 min in `risk-router.ts`) exists but the notification only shows the intent `goal` and `reasoning` in text -- no structured, machine-readable scope that the human can verify against the actual token issued.
  - Post-authorization audit is weak: "I approved a token with `task:write` scope" tells you nothing about what the agent actually did with it.

- **Pull**:
  - RAR-enriched consent shows exactly what the agent wants: "Create invoice for Acme Corp, amount: $12,000, via Stripe API" instead of "finance:write"
  - The human can constrain the authorization: "Approved, but cap the amount at $10,000" -- this constraint flows into the `authorization_details` of the issued token
  - The Authorizer Agent evaluates every request as a Rich Intent Object, providing structured reasoning the human can review
  - Every authorization decision is auditable: the `authorization_details` at time of consent is immutable and linked to the token
  - Uniform model means the human reviews the same `brain_action` structure whether the agent is reading or writing -- consistent mental model

### Demand-Reducing

- **Anxiety**:
  - Will I be overwhelmed with consent requests? If every Brain operation requires RAR, will every read also need human review?
  - What if the structured `authorization_details` is too technical? "action: read, resource: knowledge_graph, constraints: { depth: 2 }" -- can a non-technical human owner parse this?
  - What if I miss the veto window? The current 30-minute window may not be long enough for overnight/weekend actions
  - What if I approve something and it goes wrong? Is there a way to revoke an in-flight authorization?

- **Habit**:
  - Humans are used to coarse-grained OAuth consent screens ("Allow this app to access your calendar?"). Per-action structured consent is unfamiliar.
  - The existing `/oauth2/consent` endpoint in Better Auth shows a simple allow/deny UI -- adding RAR details changes the consent UX significantly
  - Workspace owners currently trust the authority system (5-tier permission matrix in `authority.ts`) to handle agent permissions -- adding explicit human consent for high-risk actions is a new responsibility

### Assessment

- **Switch likelihood**: HIGH -- the existing veto window mechanism proves the team already recognizes the need for human oversight on consequential actions. RAR makes that oversight meaningful rather than ceremonial.
- **Key blocker**: Consent fatigue anxiety -- the risk router still determines which actions need human review (high risk), which auto-approve (low risk). The difference is that ALL actions use RAR, but only high-risk ones trigger human consent. Low-risk reads auto-approve through the Authorizer Agent without human involvement.
- **Key enabler**: The existing risk router (`routeByRisk` in `risk-router.ts`) already classifies actions by risk score. This classification determines notification routing (human review vs auto-approve) but NOT the authorization mechanism (all use RAR uniformly).
- **Design implication**: The consent UI must present `authorization_details` in human-readable form, not raw JSON. A rendering layer translates `{ type: "brain_action", action: "create", resource: "invoice", constraints: { provider: "stripe", amount: 240000 } }` into "Create a Stripe invoice for $2,400.00."

---

## Job 3: Brain Resource Server Verifying Uniform Authorization

### Demand-Generating

- **Push**:
  - The current `authenticateMcpRequest` validates Bearer tokens via JWKS -- but any entity holding the token can use it. Token leakage means full impersonation.
  - Scope-based authorization at the resource server level is coarse: a token with `task:write` can create, update, delete, or complete any task in the workspace. The resource server cannot distinguish which specific operation was authorized.
  - There is no replay protection -- the same token can be presented unlimited times from any source until it expires.
  - **A tiered system (scopes for reads, RAR for writes) creates two verification paths at the resource server, doubling the attack surface and maintenance burden.** Every "if scope then... else if RAR then..." branch is a potential bypass.

- **Pull**:
  - Uniform DPoP+RAR verification means ONE verification pipeline for ALL requests. No branching, no "is this a scope or RAR request?" classification.
  - DPoP verification adds cryptographic sender-constraining: even if the token leaks, an attacker cannot forge a valid DPoP proof without the private key
  - RAR verification at the resource server means each request is checked against the specific `brain_action` -- a token for "read project tasks" cannot be used to "delete project"
  - DPoP `jti` nonces provide replay protection -- each proof is single-use
  - Human parity: whether Marcus or agent Kira makes the request, the same verification pipeline runs

### Demand-Reducing

- **Anxiety**:
  - DPoP verification adds latency to every API call -- two JWT validations (access token + DPoP proof) instead of one
  - Clock skew between actor runtime and resource server can cause false rejections
  - Nonce storage for replay protection (`jti` seen-set) grows with every request -- not just consequential ones
  - Clean cut -- no coexistence period: ALL Brain clients must support DPoP+RAR from deployment. When the Custom AS goes live, existing Bearer+scope tokens are immediately invalid. The Bridge is the only path for human operators.

- **Habit**:
  - Resource servers validate one header (`Authorization: Bearer ...`) -- adding a second header (`DPoP: ...`) doubles the surface area
  - The current `createJwtValidator` is a clean, simple function -- adding DPoP proof validation makes it significantly more complex
  - Developers testing with curl or Postman currently paste a Bearer token and go -- DPoP requires generating a key pair, constructing a signed proof, and sending both headers
  - The nonce cache pattern introduces server-side state, which conflicts with the platform's functional/stateless preference

### Assessment

- **Switch likelihood**: HIGH -- the uniform model eliminates the classification vulnerability entirely. The push is strongest because a tiered system creates a "downgrade attack" surface where an attacker forces a request through the scope-only path.
- **Key blocker**: The nonce cache scaling for ALL requests (not just consequential ones) requires careful design. Time-windowed sets with aggressive TTLs mitigate unbounded growth.
- **Key enabler**: The existing `authenticateMcpRequest` already follows a pipeline pattern. Replacing the entire pipeline (rather than adding a parallel path) is actually simpler than maintaining two paths.
- **Design implication**: The resource server has ONE verification pipeline. No Bearer fallback. No scope-only path. Better Auth session cookies are rejected at the Brain boundary -- the Bridge must be used.

---

## Job 4: Human Operator Exchanging Session for Brain Token (The Bridge)

### Demand-Generating

- **Push**:
  - Currently, a Better Auth session cookie grants direct access to the Brain API. If the session is hijacked (XSS, CSRF, cookie theft), the attacker has full access to the knowledge graph.
  - There is no separation between "I am a logged-in human" (authentication) and "I am authorized to perform this Brain operation" (authorization) -- these are conflated.
  - Session cookies carry no structured authorization information. The server cannot tell what specific operation the human intends to perform until the request body is parsed, by which time authentication has already been granted.
  - Humans operate on the Brain with fundamentally different authorization mechanisms than agents, making audit trails inconsistent and security policies bifurcated.

- **Pull**:
  - The Bridge cleanly separates authentication (Better Auth session = "I am Marcus") from authorization (RAR token = "I am authorized to read this project's tasks")
  - A stolen session cookie is worthless for Brain access -- the attacker also needs the DPoP private key held in the browser's memory
  - Human operations appear in the same audit trail format as agent operations -- uniform `brain_action` records
  - The Custom AS can enforce additional policies at the Bridge boundary (rate limiting, risk scoring, workspace access checks)
  - Human parity: Marcus generates a DPoP-signed intent just like agent Kira

### Demand-Reducing

- **Anxiety**:
  - Will the token exchange add perceptible latency to dashboard interactions? A graph read that was instant with a cookie now requires a round-trip to the Custom AS
  - What if the Better Auth session expires during a multi-step dashboard workflow? The user would need to re-authenticate
  - Browser-based DPoP key management is less mature than server-side -- are there browser compatibility concerns?
  - The dashboard team must integrate DPoP client-side logic, adding development complexity

- **Habit**:
  - **This is the strongest habit force in the entire analysis.** Every web application humans use grants API access via session cookies. The idea that a logged-in session cannot directly access the backend API is unprecedented in most developers' experience.
  - The existing dashboard makes direct API calls with the session cookie -- refactoring to use the Bridge touches every API call
  - Developers will question "why can't I just use the session?" repeatedly until the security model is internalized
  - Testing and debugging become harder: developers must understand both the Better Auth session AND the Bridge token exchange

### Assessment

- **Switch likelihood**: MEDIUM-HIGH -- the security benefit is compelling (session hijacking cannot touch the Brain), but the habit force is the strongest across all four jobs. Success depends on making the Bridge invisible to the end user.
- **Key blocker**: Developer experience. The Bridge must be wrapped in a client library that transparently handles token exchange, so dashboard code calls `brainClient.read("projects")` and the library handles session-to-RAR exchange, DPoP proof construction, and token caching.
- **Key enabler**: Better Auth as Proxy IdP -- the Custom AS trusts Better Auth for identity verification but issues its own DPoP-bound RAR tokens. This separation is architecturally clean and aligns with the "Soul and Skeleton" metaphor (Better Auth = Soul, Custom AS = Skeleton).
- **Design implication**: The Bridge client library must cache short-lived RAR tokens for common read operations (e.g., 60-second TTL for graph reads) to avoid per-click latency. Write operations always get fresh tokens. The dashboard user must NEVER see a "token exchange" step -- it is invisible infrastructure.
