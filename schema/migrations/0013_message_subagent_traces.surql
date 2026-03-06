BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE subagent_traces ON message TYPE option<array<object>>;
DEFINE FIELD OVERWRITE subagent_traces[*].agentId ON message TYPE string;
DEFINE FIELD OVERWRITE subagent_traces[*].intent ON message TYPE string;
DEFINE FIELD OVERWRITE subagent_traces[*].totalDurationMs ON message TYPE int;
DEFINE FIELD OVERWRITE subagent_traces[*].steps ON message TYPE array<object>;
DEFINE FIELD OVERWRITE subagent_traces[*].steps[*].type ON message TYPE string;
DEFINE FIELD OVERWRITE subagent_traces[*].steps[*].toolName ON message TYPE option<string>;
DEFINE FIELD OVERWRITE subagent_traces[*].steps[*].argsJson ON message TYPE option<string>;
DEFINE FIELD OVERWRITE subagent_traces[*].steps[*].resultJson ON message TYPE option<string>;
DEFINE FIELD OVERWRITE subagent_traces[*].steps[*].durationMs ON message TYPE option<int>;
DEFINE FIELD OVERWRITE subagent_traces[*].steps[*].text ON message TYPE option<string>;

COMMIT TRANSACTION;
