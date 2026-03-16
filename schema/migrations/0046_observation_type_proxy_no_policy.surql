BEGIN TRANSACTION;

-- Add proxy_no_policy to the observation_type allowed values
DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error", "alignment", "proxy_no_policy"] OR $value IS NONE;

COMMIT TRANSACTION;
