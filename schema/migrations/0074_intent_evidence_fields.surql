-- Migration: Add evidence_refs and evidence_verification fields to intent table,
-- and evidence_enforcement field to workspace table.
-- Step-ID: 01-01

BEGIN TRANSACTION;

-- Intent: array of record references pointing to evidence entities
DEFINE FIELD OVERWRITE evidence_refs ON intent TYPE option<array<record<decision | task | feature | project | observation | policy | objective | learning | git_commit>>>;

-- Intent: verification result object written by the evidence verification pipeline
DEFINE FIELD OVERWRITE evidence_verification ON intent TYPE option<object>;
DEFINE FIELD OVERWRITE evidence_verification.verified_count ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.failed_refs ON intent TYPE option<array<string>>;
DEFINE FIELD OVERWRITE evidence_verification.verification_time_ms ON intent TYPE int;
DEFINE FIELD OVERWRITE evidence_verification.warnings ON intent TYPE option<array<string>>;

-- Workspace: evidence enforcement mode (bootstrap = no requirements, soft = penalty, hard = reject)
DEFINE FIELD OVERWRITE evidence_enforcement ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['bootstrap', 'soft', 'hard'];

COMMIT TRANSACTION;
