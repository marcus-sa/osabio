-- Add "alignment" to observation_type assertion for intent-objective alignment observations
BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error", "alignment"] OR $value IS NONE;

COMMIT TRANSACTION;
