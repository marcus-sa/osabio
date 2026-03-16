-- Add source field to agent_session to distinguish how sessions were created.
-- Values: "cli" (brain CLI), "proxy_hash" (deterministic content hash fallback), etc.

DEFINE FIELD OVERWRITE source ON agent_session TYPE option<string>;
