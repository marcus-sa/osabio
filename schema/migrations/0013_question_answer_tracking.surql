BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE answered_at ON question TYPE option<datetime>;
DEFINE FIELD OVERWRITE answered_by_message ON question TYPE option<record<message>>;

COMMIT TRANSACTION;
