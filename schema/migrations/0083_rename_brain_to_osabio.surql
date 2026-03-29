-- Rename brain to osabio across schema identifiers
BEGIN TRANSACTION;

-- Intent authorization_details type
ALTER FIELD authorization_details[*].type ON intent ASSERT $value = "osabio_action";

-- Agent runtime enum
UPDATE agent SET runtime = "osabio" WHERE runtime = "brain";
ALTER FIELD runtime ON agent ASSERT $value IN ['osabio', 'sandbox', 'external'];

-- Analytics user password
REMOVE USER analytics ON DATABASE;
DEFINE USER analytics ON DATABASE PASSWORD 'osabio-analytics-readonly' ROLES VIEWER;

COMMIT TRANSACTION;
