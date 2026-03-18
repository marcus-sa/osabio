-- Automatically set decision status to "superseded" when a superseded_by edge is created.
-- The edge is the source of truth; status is a derived consequence.
DEFINE EVENT OVERWRITE decision_superseded ON superseded_by
  WHEN $event = "CREATE"
  THEN {
    UPDATE $after.in SET status = "superseded", updated_at = time::now();
  };
