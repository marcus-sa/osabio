BEGIN TRANSACTION;
  DEFINE TABLE similar_to TYPE RELATION IN observation OUT observation SCHEMAFULL;
  DEFINE FIELD similarity ON similar_to TYPE float;
  DEFINE FIELD created_at ON similar_to TYPE datetime;
COMMIT TRANSACTION;
