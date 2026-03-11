# Observer Agent — Shared Artifacts Registry

Every `${variable}` used across journey/requirement artifacts has a single documented source.

| Artifact | Source | Type | Description |
|----------|--------|------|-------------|
| `${record.id}` | SurrealDB EVENT `$after` | `RecordId` | The entity that triggered the event |
| `${record.workspace}` | SurrealDB EVENT `$after.workspace` | `RecordId<workspace>` | Workspace scope for authorization |
| `${$before.status}` | SurrealDB EVENT `$before` | `string` | Status before the transition |
| `${$after.status}` | SurrealDB EVENT `$after` | `string` | Status after the transition |
| `${entity_table}` | Parsed from webhook route param | `"task" \| "intent"` | Table name of the triggering entity |
| `${entity_id}` | Parsed from webhook route param | `string` | Raw ID of the triggering entity |
| `${external_signals}` | Observer agent external API queries | `Array<{ source, data }>` | Signals gathered from GitHub/CI/etc |
| `${verdict}` | Observer agent comparison logic | `"match" \| "mismatch" \| "inconclusive"` | Result of claim vs reality comparison |
| `${observation.id}` | `createObservation()` return | `RecordId<observation>` | Created observation record |
| `${workspace_integrations}` | Workspace config (future) | `Array<Integration>` | External services configured for workspace |

## Schema Extensions Required

| Field | Table | Type | Purpose |
|-------|-------|------|---------|
| `verified` | `observation` | `bool DEFAULT false` | Whether observation was grounded by external signal |
| `source` | `observation` | `option<string>` | External source that provided the signal (e.g., "GitHub CI") |
| `data` | `observation` | `option<object>` | Raw metrics/evidence from external signals |
| `related_intent` | `observation` | `option<record<intent>>` | Direct link to triggering intent (alternative to `observes` edge) |
| `observer` | `observation` | `option<string>` | Agent identity that created the observation (extends existing `source_agent`) |

## Existing Fields Reused

| Field | Already Exists | Reuse |
|-------|---------------|-------|
| `observation_type` | Yes — `contradiction`, `duplication`, `missing`, `deprecated`, `pattern`, `anomaly` | Add `validation` and `error` to the enum |
| `source_agent` | Yes | Set to `"observer_agent"` |
| `severity` | Yes — `info`, `warning`, `conflict` | No changes needed |
| `status` | Yes — `open`, `acknowledged`, `resolved` | No changes needed |
| `observes` edge | Yes — `observation → project\|feature\|task\|decision\|question` | Add `intent` to OUT types |

## SurrealDB EVENTs Required

| Event | Table | Trigger | Endpoint |
|-------|-------|---------|----------|
| `task_completed` | `task` | `status` transitions to `completed` or `done` | `POST /api/observe/task/:taskId` |
| `intent_completed` | `intent` | `status` transitions to `completed` or `failed` | `POST /api/observe/intent/:intentId` |
