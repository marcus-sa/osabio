-- Migration: Add evidence_enforcement_transitions array to workspace table
-- Stores audit trail of enforcement mode transitions (auto and manual).
-- Step-ID: 08-05

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE evidence_enforcement_transitions ON workspace TYPE option<array<object>>;
DEFINE FIELD OVERWRITE evidence_enforcement_transitions[*].from ON workspace TYPE string;
DEFINE FIELD OVERWRITE evidence_enforcement_transitions[*].to ON workspace TYPE string;
DEFINE FIELD OVERWRITE evidence_enforcement_transitions[*].trigger ON workspace TYPE string
  ASSERT $value IN ['auto', 'manual'];
DEFINE FIELD OVERWRITE evidence_enforcement_transitions[*].timestamp ON workspace TYPE datetime;

COMMIT TRANSACTION;
