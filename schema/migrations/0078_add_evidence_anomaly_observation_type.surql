-- Add "evidence_anomaly" to the observation_type ASSERT constraint
-- for Observer evidence spam detection scan results.
BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error", "alignment", "evidence_anomaly"] OR $value IS NONE;

COMMIT TRANSACTION;
