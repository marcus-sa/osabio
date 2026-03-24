-- Migration 0071: Add device fields to agent table for OpenClaw Gateway
-- Extends agent_type enum to include 'openclaw' and adds device identity fields
-- for Ed25519 public key binding, fingerprinting, and platform metadata.

BEGIN TRANSACTION;

-- Extend agent_type to include 'openclaw'
ALTER FIELD agent_type ON agent TYPE string
  ASSERT $value IN ['code_agent', 'architect', 'management', 'design_partner', 'observer', 'chat_agent', 'mcp', 'openclaw'];

-- Device identity fields for gateway-connected agents
DEFINE FIELD OVERWRITE device_fingerprint ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE device_public_key ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE device_platform ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE device_family ON agent TYPE option<string>;

-- Index on device_fingerprint for lookup during authentication
DEFINE INDEX OVERWRITE idx_agent_device_fingerprint ON agent FIELDS device_fingerprint;

COMMIT TRANSACTION;
