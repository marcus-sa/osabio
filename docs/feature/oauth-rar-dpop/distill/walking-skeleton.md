# Walking Skeleton Design: OAuth RAR+DPoP

## Purpose

The walking skeletons prove that the two critical E2E authorization paths deliver observable user value. They answer: "Can an actor accomplish their goal through the sovereign auth model?"

## Skeleton 1: Agent Token Acquisition and Brain Access

**User goal**: An agent acquires authorization for a Brain operation and executes it.

**E2E path**:
1. Agent generates ES256 key pair (session startup)
2. Agent submits intent with brain_action + dpop_jwk_thumbprint
3. Evaluation pipeline authorizes the intent
4. Agent requests token from Custom AS with DPoP proof
5. Agent presents DPoP token + fresh proof to Brain endpoint
6. Brain verifies proof, checks authorization, and processes the request

**Why this skeleton**: This is the primary authorization flow for all AI agents. If this path fails, no agent can perform any Brain operation. It touches every new component: DPoP key generation, intent submission with thumbprint binding, Custom AS token issuance, and Brain resource server DPoP verification.

**Traces**: US-001 (key pair), US-002 (intent submission), US-003 (token issuance), US-005 (DPoP verification), US-006 (RAR scope verification)

**Stakeholder demo**: "Watch -- the agent declares what it wants to do, gets authorized, receives a cryptographic proof token, and uses it to access the Brain. If someone steals the token, they can't use it because they don't have the agent's private key."

## Skeleton 2: Human Bridge Exchange and Brain Access

**User goal**: A dashboard user accesses Brain data through the new DPoP authorization model.

**E2E path**:
1. Human logs in via Better Auth (session cookie)
2. Dashboard generates ES256 key pair (browser session)
3. Dashboard exchanges session + DPoP proof for RAR token via Bridge
4. Dashboard presents DPoP token + fresh proof to Brain endpoint
5. Brain verifies identically to agent path and processes the request

**Why this skeleton**: This proves that the human path converges with the agent path at the Brain boundary. The Bridge is the critical new component that translates session-based human identity into the same DPoP-bound tokens that agents use. Without it, humans cannot interact with the Brain through the new auth model.

**Traces**: US-001 (key pair), US-005 (DPoP verification), US-006 (RAR scope verification), US-007 (Bridge exchange)

**Stakeholder demo**: "The dashboard user logs in normally, but when they need to access Brain data, the dashboard transparently exchanges their session for a DPoP token. From the Brain's perspective, the human and agent requests look identical."

## Litmus Test Results

Both skeletons pass the walking skeleton litmus test:

1. **Title describes user goal**: "Agent acquires authorization and accesses Brain" / "Human exchanges session for token and accesses Brain" -- not "token passes through all layers"
2. **Given/When describe user actions**: "agent submits intent declaring what it wants to do" -- not "POST to /api/auth/intents with JSON body"
3. **Then describe observable outcomes**: "Brain verifies and grants access" -- not "middleware returns 200 with auth context object"
4. **Stakeholder confirmation**: Non-technical stakeholder can verify "yes, that is the authorization flow users need"

## Implementation Sequence

1. Enable Skeleton 1 first (agent path) -- this exercises 5 of 8 user stories
2. Enable Skeleton 2 second (human path) -- this adds Bridge exchange
3. Enable Milestone 1 scenarios (key pair + intent details)
4. Enable Milestone 2 scenarios (token issuance edge cases)
5. Enable Milestone 3 scenarios (Brain verification error paths)
6. Enable Milestone 4 scenarios (Bridge exchange error paths)
7. Enable Milestone 5 scenarios (consent + identity)
