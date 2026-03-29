BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE settings.sandbox_provider ON workspace TYPE option<string>
  ASSERT $value = NONE OR $value IN ['local', 'e2b', 'daytona', 'docker'];

COMMIT TRANSACTION;
