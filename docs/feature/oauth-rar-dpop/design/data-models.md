# Data Models: OAuth 2.1 RAR + DPoP

## Schema Changes

### Intent Table Extension

New fields on existing `intent` table:

```sql
-- osabio_action authorization_details (replaces action_spec as authorization source)
DEFINE FIELD OVERWRITE authorization_details ON intent TYPE array<object>;
DEFINE FIELD OVERWRITE authorization_details[*].type ON intent TYPE string
  ASSERT $value = "osabio_action";
DEFINE FIELD OVERWRITE authorization_details[*].action ON intent TYPE string;
DEFINE FIELD OVERWRITE authorization_details[*].resource ON intent TYPE string;
DEFINE FIELD OVERWRITE authorization_details[*].constraints ON intent TYPE option<object> FLEXIBLE;

-- DPoP key binding
DEFINE FIELD OVERWRITE dpop_jwk_thumbprint ON intent TYPE string;

-- Token tracking
DEFINE FIELD OVERWRITE token_issued_at ON intent TYPE option<datetime>;
DEFINE FIELD OVERWRITE token_expires_at ON intent TYPE option<datetime>;
```

Note: `action_spec` is preserved during transition. The evaluation pipeline reads `authorization_details` when present, falls back to `action_spec` for pre-migration intents.

### Audit Event Table (New)

```sql
DEFINE TABLE audit_event SCHEMAFULL;

DEFINE FIELD event_type ON audit_event TYPE string
  ASSERT $value IN [
    "intent_submitted",
    "intent_evaluated",
    "intent_routed",
    "consent_approved",
    "consent_constrained",
    "consent_vetoed",
    "token_issued",
    "token_rejected",
    "dpop_verified",
    "dpop_rejected",
    "security_alert"
  ];

DEFINE FIELD severity ON audit_event TYPE string
  ASSERT $value IN ["info", "warning", "security"];

DEFINE FIELD actor ON audit_event TYPE record<identity>;
DEFINE FIELD workspace ON audit_event TYPE record<workspace>;
DEFINE FIELD intent_id ON audit_event TYPE option<record<intent>>;
DEFINE FIELD dpop_thumbprint ON audit_event TYPE option<string>;

-- Event-specific payload (flexible for different event types)
DEFINE FIELD payload ON audit_event TYPE object FLEXIBLE;

DEFINE FIELD created_at ON audit_event TYPE datetime;

-- Indexes
DEFINE INDEX audit_event_workspace_type ON audit_event FIELDS workspace, event_type;
DEFINE INDEX audit_event_created_at ON audit_event FIELDS created_at;
DEFINE INDEX audit_event_intent ON audit_event FIELDS intent_id;
DEFINE INDEX audit_event_severity ON audit_event FIELDS severity;
```

### AS Signing Key Table (New)

```sql
DEFINE TABLE as_signing_key SCHEMAFULL;

DEFINE FIELD kid ON as_signing_key TYPE string;
DEFINE FIELD algorithm ON as_signing_key TYPE string ASSERT $value = "ES256";
DEFINE FIELD public_jwk ON as_signing_key TYPE object FLEXIBLE;
DEFINE FIELD private_jwk ON as_signing_key TYPE object FLEXIBLE;
DEFINE FIELD status ON as_signing_key TYPE string
  ASSERT $value IN ["active", "rotated"];
DEFINE FIELD created_at ON as_signing_key TYPE datetime;
DEFINE FIELD rotated_at ON as_signing_key TYPE option<datetime>;

DEFINE INDEX as_signing_key_kid ON as_signing_key FIELDS kid UNIQUE;
DEFINE INDEX as_signing_key_status ON as_signing_key FIELDS status;
```

---

## TypeScript Types

### OsabioAction (authorization_details entry)

```typescript
type OsabioAction = {
  type: "osabio_action";
  action: string;
  resource: string;
  constraints?: Record<string, unknown>;
};
```

### DPoP Proof Claims

```typescript
type DPoPProofHeader = {
  typ: "dpop+jwt";
  alg: "ES256";
  jwk: JsonWebKey;
};

type DPoPProofPayload = {
  jti: string;
  htm: string;      // HTTP method
  htu: string;      // HTTP URI (scheme + host + path)
  iat: number;      // issued at (epoch seconds)
};
```

### DPoP-Bound Access Token Claims

```typescript
type DPoPBoundTokenClaims = {
  sub: string;                              // identity ID
  iss: string;                              // Custom AS issuer URL
  aud: string;                              // Osabio resource server URL
  exp: number;                              // expiry (epoch seconds)
  iat: number;                              // issued at
  cnf: { jkt: string };                     // JWK thumbprint (sender binding)
  authorization_details: OsabioAction[];     // what the token authorizes
  "urn:osabio:intent_id": string;            // link to authorizing intent
  "urn:osabio:workspace": string;            // workspace scope
  "urn:osabio:actor_type"?: string;          // "human" | "agent" (informational only)
};
```

### Extended IntentRecord

```typescript
type IntentRecord = {
  // ... existing fields (goal, reasoning, status, priority, action_spec, etc.)

  // NEW: osabio_action authorization_details
  authorization_details: OsabioAction[];

  // NEW: DPoP key binding
  dpop_jwk_thumbprint: string;

  // NEW: Token tracking
  token_issued_at?: Date;
  token_expires_at?: Date;
};
```

### Validation Result Types

```typescript
type DPoPValidationResult =
  | { valid: true; thumbprint: string; claims: DPoPProofPayload }
  | { valid: false; error: string; code: DPoPErrorCode };

type DPoPErrorCode =
  | "dpop_required"
  | "dpop_invalid_structure"
  | "dpop_invalid_signature"
  | "dpop_proof_expired"
  | "dpop_proof_reused"
  | "dpop_binding_mismatch"
  | "dpop_key_mismatch";

type RARVerificationResult =
  | { authorized: true }
  | { authorized: false; error: string; code: RARErrorCode };

type RARErrorCode =
  | "authorization_details_missing"
  | "authorization_details_mismatch"
  | "authorization_params_exceeded";

type TokenIssuanceResult =
  | { ok: true; token: string; expires_at: Date }
  | { ok: false; error: string; code: string };
```

### Auth Context (replaces McpAuthResult)

```typescript
type DPoPAuthResult = {
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  identityRecord: RecordId<"identity", string>;
  actorType: "human" | "agent";
  authorizationDetails: OsabioAction[];
  intentId: string;
  dpopThumbprint: string;
};
```

---

## Token Format

### DPoP-Bound Access Token (JWT)

```json
{
  "header": {
    "alg": "ES256",
    "typ": "at+jwt",
    "kid": "<AS signing key ID>"
  },
  "payload": {
    "sub": "<identity record ID>",
    "iss": "http://localhost:3000/api/auth/brain",
    "aud": "http://localhost:3000",
    "exp": 1741619400,
    "iat": 1741619100,
    "cnf": {
      "jkt": "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs"
    },
    "authorization_details": [
      {
        "type": "osabio_action",
        "action": "create",
        "resource": "invoice",
        "constraints": {
          "provider": "stripe",
          "customer": "cus_acme_corp",
          "amount": 240000
        }
      }
    ],
    "urn:osabio:intent_id": "abc123",
    "urn:osabio:workspace": "lusaka-ws-001"
  }
}
```

### DPoP Proof (JWT)

```json
{
  "header": {
    "typ": "dpop+jwt",
    "alg": "ES256",
    "jwk": {
      "kty": "EC",
      "crv": "P-256",
      "x": "...",
      "y": "..."
    }
  },
  "payload": {
    "jti": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "htm": "POST",
    "htu": "http://localhost:3000/api/mcp/lusaka-ws-001/tasks/status",
    "iat": 1741619100
  }
}
```

---

## Route-to-OsabioAction Mapping

The Osabio resource server derives a `osabio_action` from each incoming HTTP request:

| HTTP Method + Path Pattern | osabio_action.action | osabio_action.resource |
|---|---|---|
| `POST /api/mcp/:ws/workspace-context` | read | workspace |
| `POST /api/mcp/:ws/project-context` | read | project |
| `POST /api/mcp/:ws/task-context` | read | task |
| `POST /api/mcp/:ws/decisions` | read | decision |
| `POST /api/mcp/:ws/constraints` | read | constraint |
| `POST /api/mcp/:ws/changes` | read | change_log |
| `GET /api/mcp/:ws/entities/:id` | read | entity |
| `POST /api/mcp/:ws/decisions/resolve` | reason | decision |
| `POST /api/mcp/:ws/constraints/check` | reason | constraint |
| `POST /api/mcp/:ws/decisions/provisional` | create | decision |
| `POST /api/mcp/:ws/questions` | create | question |
| `POST /api/mcp/:ws/tasks/status` | update | task |
| `POST /api/mcp/:ws/tasks/subtask` | create | task |
| `POST /api/mcp/:ws/notes` | create | note |
| `POST /api/mcp/:ws/observations` | create | observation |
| `POST /api/mcp/:ws/suggestions/create` | create | suggestion |
| `POST /api/mcp/:ws/sessions/start` | create | session |
| `POST /api/mcp/:ws/sessions/end` | update | session |
| `POST /api/mcp/:ws/commits` | create | commit |
| `POST /api/mcp/:ws/intents/create` | create | intent |
| `POST /api/mcp/:ws/intents/submit` | submit | intent |

Constraints are extracted from request body where applicable (e.g., task_id, project_id, amount).
