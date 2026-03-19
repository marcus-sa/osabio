BEGIN TRANSACTION;

-- Remove proxy_no_policy from observation_type enum (was never used; "missing" covers this case)
DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error", "alignment"] OR $value IS NONE;

COMMIT TRANSACTION;
