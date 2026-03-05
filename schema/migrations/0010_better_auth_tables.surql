BEGIN TRANSACTION;

-- Evolve person table for better-auth
DEFINE FIELD OVERWRITE contact_email ON person TYPE string;
DEFINE FIELD OVERWRITE email_verified ON person TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE image ON person TYPE option<string>;
DEFINE FIELD OVERWRITE updated_at ON person TYPE datetime;
DEFINE INDEX OVERWRITE person_email ON person FIELDS contact_email UNIQUE;

-- Session
DEFINE TABLE OVERWRITE session SCHEMAFULL;
DEFINE FIELD OVERWRITE person_id ON session TYPE record<person>;
DEFINE FIELD OVERWRITE token ON session TYPE string;
DEFINE FIELD OVERWRITE expires_at ON session TYPE datetime;
DEFINE FIELD OVERWRITE ip_address ON session TYPE option<string>;
DEFINE FIELD OVERWRITE user_agent ON session TYPE option<string>;
DEFINE FIELD OVERWRITE created_at ON session TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON session TYPE datetime;
DEFINE INDEX OVERWRITE session_token ON session FIELDS token UNIQUE;
DEFINE INDEX OVERWRITE session_person_id ON session FIELDS person_id;

-- Account (OAuth provider links)
DEFINE TABLE OVERWRITE account SCHEMAFULL;
DEFINE FIELD OVERWRITE person_id ON account TYPE record<person>;
DEFINE FIELD OVERWRITE account_id ON account TYPE string;
DEFINE FIELD OVERWRITE provider_id ON account TYPE string;
DEFINE FIELD OVERWRITE access_token ON account TYPE option<string>;
DEFINE FIELD OVERWRITE refresh_token ON account TYPE option<string>;
DEFINE FIELD OVERWRITE access_token_expires_at ON account TYPE option<datetime>;
DEFINE FIELD OVERWRITE refresh_token_expires_at ON account TYPE option<datetime>;
DEFINE FIELD OVERWRITE scope ON account TYPE option<string>;
DEFINE FIELD OVERWRITE id_token ON account TYPE option<string>;
DEFINE FIELD OVERWRITE password ON account TYPE option<string>;
DEFINE FIELD OVERWRITE created_at ON account TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON account TYPE datetime;
DEFINE INDEX OVERWRITE account_person_id ON account FIELDS person_id;
DEFINE INDEX OVERWRITE account_provider ON account FIELDS provider_id, account_id;

-- Verification
DEFINE TABLE OVERWRITE verification SCHEMAFULL;
DEFINE FIELD OVERWRITE identifier ON verification TYPE string;
DEFINE FIELD OVERWRITE value ON verification TYPE string;
DEFINE FIELD OVERWRITE expires_at ON verification TYPE datetime;
DEFINE FIELD OVERWRITE created_at ON verification TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON verification TYPE datetime;
DEFINE INDEX OVERWRITE verification_identifier ON verification FIELDS identifier;

COMMIT TRANSACTION;
