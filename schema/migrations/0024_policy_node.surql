BEGIN TRANSACTION;

-- Policy table: governance rules for intent authorization
DEFINE TABLE OVERWRITE policy SCHEMAFULL;
DEFINE FIELD title ON policy TYPE string;
DEFINE FIELD description ON policy TYPE option<string>;
DEFINE FIELD version ON policy TYPE int ASSERT $value > 0;
DEFINE FIELD status ON policy TYPE string
  ASSERT $value IN ['active', 'draft', 'deprecated', 'testing', 'superseded'];
DEFINE FIELD selector ON policy TYPE object;
DEFINE FIELD selector.workspace ON policy TYPE option<string>;
DEFINE FIELD selector.agent_role ON policy TYPE option<string>;
DEFINE FIELD selector.resource ON policy TYPE option<string>;
DEFINE FIELD rules ON policy TYPE array<object>;
DEFINE FIELD rules[*].id ON policy TYPE string;
DEFINE FIELD rules[*].condition ON policy TYPE object FLEXIBLE;
DEFINE FIELD rules[*].effect ON policy TYPE string ASSERT $value IN ['allow', 'deny'];
DEFINE FIELD rules[*].priority ON policy TYPE int;
DEFINE FIELD human_veto_required ON policy TYPE bool DEFAULT false;
DEFINE FIELD max_ttl ON policy TYPE option<string>;
DEFINE FIELD created_by ON policy TYPE record<identity>;
DEFINE FIELD workspace ON policy TYPE record<workspace>;
DEFINE FIELD supersedes ON policy TYPE option<record<policy>>;
DEFINE FIELD created_at ON policy TYPE datetime;
DEFINE FIELD updated_at ON policy TYPE option<datetime>;
DEFINE INDEX policy_status ON policy FIELDS status;
DEFINE INDEX policy_workspace ON policy FIELDS workspace;
DEFINE INDEX policy_workspace_status ON policy FIELDS workspace, status;

-- Graph relation: identity -governing-> policy
DEFINE TABLE OVERWRITE governing TYPE RELATION IN identity OUT policy SCHEMAFULL;
DEFINE FIELD created_at ON governing TYPE datetime;
DEFINE INDEX governing_out ON governing FIELDS out;

-- Graph relation: policy -protects-> workspace
DEFINE TABLE OVERWRITE protects TYPE RELATION IN policy OUT workspace SCHEMAFULL;
DEFINE FIELD created_at ON protects TYPE datetime;
DEFINE INDEX protects_in ON protects FIELDS in;

-- Extend intent.evaluation with policy_trace fields
DEFINE FIELD OVERWRITE evaluation.policy_trace ON intent TYPE option<array<object>>;
DEFINE FIELD evaluation.policy_trace[*].policy_id ON intent TYPE string;
DEFINE FIELD evaluation.policy_trace[*].policy_version ON intent TYPE int;
DEFINE FIELD evaluation.policy_trace[*].rule_id ON intent TYPE string;
DEFINE FIELD evaluation.policy_trace[*].effect ON intent TYPE string ASSERT $value IN ['allow', 'deny'];
DEFINE FIELD evaluation.policy_trace[*].matched ON intent TYPE bool;
DEFINE FIELD evaluation.policy_trace[*].priority ON intent TYPE int;
DEFINE FIELD OVERWRITE evaluation.human_veto_required ON intent TYPE option<bool>;

-- Extend audit_event event_type with policy lifecycle events
DEFINE FIELD OVERWRITE event_type ON audit_event TYPE string
  ASSERT $value IN [
    "intent_submitted", "intent_evaluated", "intent_routed",
    "consent_approved", "consent_constrained", "consent_vetoed",
    "token_issued", "token_rejected",
    "dpop_verified", "dpop_rejected",
    "security_alert",
    "policy_created", "policy_activated", "policy_updated", "policy_deprecated"
  ];

COMMIT TRANSACTION;
