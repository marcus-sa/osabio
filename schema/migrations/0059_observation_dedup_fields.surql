BEGIN TRANSACTION;
  DEFINE FIELD OVERWRITE occurrence_count ON observation TYPE int DEFAULT 1;
  DEFINE FIELD OVERWRITE last_seen_at ON observation TYPE option<datetime>;
  UPDATE observation SET occurrence_count = 1, last_seen_at = created_at WHERE occurrence_count IS NONE;
COMMIT TRANSACTION;
