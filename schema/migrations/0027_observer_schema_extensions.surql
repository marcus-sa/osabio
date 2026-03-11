-- Observer agent schema extensions: add verified, source, data fields
-- and extend observation_type enum with "validation" and "error".

BEGIN TRANSACTION;

-- New fields on observation table
DEFINE FIELD OVERWRITE verified ON observation TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE source ON observation TYPE option<string>;
DEFINE FIELD OVERWRITE data ON observation TYPE option<object> FLEXIBLE;

-- Extend observation_type enum to include "validation" and "error"
DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error"] OR $value IS NONE;

COMMIT TRANSACTION;
