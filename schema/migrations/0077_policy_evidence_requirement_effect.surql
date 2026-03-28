BEGIN TRANSACTION;

-- Allow 'evidence_requirement' as a policy rule effect
DEFINE FIELD OVERWRITE rules[*].effect ON policy TYPE string ASSERT $value IN ['allow', 'deny', 'evidence_requirement'];
DEFINE FIELD OVERWRITE rules[*].min_evidence_count ON policy TYPE option<int>;
DEFINE FIELD OVERWRITE rules[*].required_types ON policy TYPE option<array<string>>;

-- Allow 'evidence_requirement' in intent policy trace
DEFINE FIELD OVERWRITE evaluation.policy_trace[*].effect ON intent TYPE string ASSERT $value IN ['allow', 'deny', 'evidence_requirement'];

COMMIT TRANSACTION;
