-- Migration 0022: OAuth 2.1 RAR+DPoP schema extensions
-- Extends intent table with authorization_details and DPoP fields.
-- Adds audit_event and as_signing_key tables.
-- Extends identity table with managed_by, identity_status, revoked_at.

-- Intent table extensions: RAR authorization details
DEFINE FIELD OVERWRITE authorization_details ON intent TYPE option<array<object>>;
DEFINE FIELD OVERWRITE authorization_details[*].type ON intent TYPE string ASSERT $value = "brain_action";
DEFINE FIELD OVERWRITE authorization_details[*].action ON intent TYPE string;
DEFINE FIELD OVERWRITE authorization_details[*].resource ON intent TYPE string;
DEFINE FIELD OVERWRITE authorization_details[*].constraints ON intent TYPE option<object> FLEXIBLE;

-- Intent table extensions: DPoP binding and token lifecycle
DEFINE FIELD OVERWRITE dpop_jwk_thumbprint ON intent TYPE option<string>;
DEFINE FIELD OVERWRITE token_issued_at ON intent TYPE option<datetime>;
DEFINE FIELD OVERWRITE token_expires_at ON intent TYPE option<datetime>;

-- Identity table extensions: managed identity support
DEFINE FIELD OVERWRITE managed_by ON identity TYPE option<string>;
DEFINE FIELD OVERWRITE identity_status ON identity TYPE option<string>;
DEFINE FIELD OVERWRITE revoked_at ON identity TYPE option<datetime>;

-- Audit event table
DEFINE TABLE OVERWRITE audit_event SCHEMAFULL;
DEFINE FIELD OVERWRITE event_type ON audit_event TYPE string
  ASSERT $value IN ["intent_submitted", "intent_evaluated", "intent_routed", "consent_approved", "consent_constrained", "consent_vetoed", "token_issued", "token_rejected", "dpop_verified", "dpop_rejected", "security_alert"];
DEFINE FIELD OVERWRITE severity ON audit_event TYPE string
  ASSERT $value IN ["info", "warning", "security"];
DEFINE FIELD OVERWRITE actor ON audit_event TYPE record<identity>;
DEFINE FIELD OVERWRITE workspace ON audit_event TYPE record<workspace>;
DEFINE FIELD OVERWRITE intent_id ON audit_event TYPE option<record<intent>>;
DEFINE FIELD OVERWRITE dpop_thumbprint ON audit_event TYPE option<string>;
DEFINE FIELD OVERWRITE payload ON audit_event TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE created_at ON audit_event TYPE datetime;
DEFINE INDEX OVERWRITE audit_event_workspace_type ON audit_event FIELDS workspace, event_type;
DEFINE INDEX OVERWRITE audit_event_created_at ON audit_event FIELDS created_at;
DEFINE INDEX OVERWRITE audit_event_intent ON audit_event FIELDS intent_id;
DEFINE INDEX OVERWRITE audit_event_severity ON audit_event FIELDS severity;

-- Authorization server signing key table
DEFINE TABLE OVERWRITE as_signing_key SCHEMAFULL;
DEFINE FIELD OVERWRITE kid ON as_signing_key TYPE string;
DEFINE FIELD OVERWRITE algorithm ON as_signing_key TYPE string ASSERT $value = "ES256";
DEFINE FIELD OVERWRITE public_jwk ON as_signing_key TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE private_jwk ON as_signing_key TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE status ON as_signing_key TYPE string
  ASSERT $value IN ["active", "rotated"];
DEFINE FIELD OVERWRITE created_at ON as_signing_key TYPE datetime;
DEFINE FIELD OVERWRITE rotated_at ON as_signing_key TYPE option<datetime>;
DEFINE INDEX OVERWRITE as_signing_key_kid ON as_signing_key FIELDS kid UNIQUE;
DEFINE INDEX OVERWRITE as_signing_key_status ON as_signing_key FIELDS status;
