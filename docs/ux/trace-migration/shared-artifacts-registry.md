# Shared Artifacts Registry: trace-migration

## Artifacts

### trace_table_schema
- **Source of truth**: `schema/surreal-schema.surql` (trace table definition)
- **Consumers**:
  - `app/src/server/chat/chat-route.ts` -- creates trace records in onFinish
  - `app/src/server/workspace/workspace-routes.ts` -- reads trace records for API
  - `app/src/server/chat/branch-chain.ts` -- reads traces for inheritance
  - `tests/acceptance/chat/subagent-traces.test.ts` -- validates trace structure
- **Owner**: Schema / migration pipeline
- **Integration risk**: HIGH -- field mismatch causes silent data loss in SCHEMAFULL mode
- **Validation**: After migration, run `INFO FOR TABLE trace` and verify all fields present

### spawns_relation_schema
- **Source of truth**: `schema/surreal-schema.surql` (spawns relation definition)
- **Consumers**:
  - `app/src/server/chat/chat-route.ts` -- creates spawns edge (RELATE)
  - `app/src/server/workspace/workspace-routes.ts` -- traverses `->spawns->trace`
  - `app/src/server/chat/branch-chain.ts` -- traverses `->spawns->trace`
- **Owner**: Schema / migration pipeline
- **Integration risk**: HIGH -- missing relation definition causes RELATE to fail
- **Validation**: `INFO FOR TABLE spawns` returns `TYPE RELATION IN message OUT trace`

### subagent_trace_type (contracts.ts)
- **Source of truth**: `app/src/shared/contracts.ts` (SubagentTrace, SubagentTraceStep)
- **Consumers**:
  - `app/src/server/agents/pm/agent.ts` -- produces SubagentTrace in output
  - `app/src/server/chat/chat-route.ts` -- consumes SubagentTrace, maps to trace records
  - `app/src/server/workspace/workspace-routes.ts` -- reconstructs SubagentTrace from records
  - `app/src/server/chat/branch-chain.ts` -- includes SubagentTrace in inherited messages
  - `tests/acceptance/chat/subagent-traces.test.ts` -- validates SubagentTrace shape
- **Owner**: Shared contracts
- **Integration risk**: HIGH -- type change breaks all consumers
- **Validation**: TypeScript compilation -- type errors surface immediately

### api_wire_format (subagentTraces on message response)
- **Source of truth**: `app/src/shared/contracts.ts` (WorkspaceBootstrapMessage.subagentTraces)
- **Consumers**:
  - Frontend chat page -- renders collapsible trace blocks
  - `tests/acceptance/chat/subagent-traces.test.ts` -- validates API response shape
- **Owner**: API contract
- **Integration risk**: MEDIUM -- format change breaks frontend rendering
- **Validation**: Acceptance test verifies wire format matches expected shape

### trace_type_enum
- **Source of truth**: `schema/surreal-schema.surql` (ASSERT on trace.type field)
- **Current values**: `tool_call`, `message`, `subagent_spawn`, `intent_submission`, `bridge_exchange`
- **Consumers**:
  - `app/src/server/chat/chat-route.ts` -- writes `subagent_spawn`, `tool_call`, `message`
  - Any future subagent implementation
- **Owner**: Schema
- **Integration risk**: MEDIUM -- invalid type rejected by ASSERT, hard failure at write time
- **Validation**: Verify write path uses only values in the ASSERT set

## Consistency Matrix

| Artifact | Schema | Write Path | Read (conv) | Read (branch) | PM Agent | Test |
|----------|--------|-----------|-------------|---------------|----------|------|
| trace_table_schema | DEFINE | CREATE | SELECT | SELECT | -- | SELECT |
| spawns_relation | DEFINE | RELATE | TRAVERSE | TRAVERSE | -- | TRAVERSE |
| SubagentTrace type | -- | consume | produce | produce | produce | validate |
| API wire format | -- | -- | serialize | serialize | -- | validate |
| trace.type enum | ASSERT | write | read | read | -- | validate |
