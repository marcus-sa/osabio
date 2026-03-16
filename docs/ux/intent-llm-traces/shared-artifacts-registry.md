# Shared Artifacts Registry: LLM Reasoning Telemetry

## Artifacts

### observation.reasoning (NEW FIELD)

| Property | Value |
|----------|-------|
| Source of truth | `observation` table, `reasoning` field (TYPE `option<string>`) |
| Owner | Observer verification pipeline (`observer/llm-reasoning.ts`) |
| Consumers | Observation detail UI ("View Logic" panel), Observer self-calibration queries, Behavior scorer reasoning analysis |
| Integration risk | **HIGH** -- this is the core new field. Must be populated by all LLM reasoning paths (verification, peer review, anomaly evaluation, contradiction detection) and consumed correctly by UI and programmatic consumers. |
| Validation | Field populated when `source = "llm"`. Field absent/NONE when `source = "deterministic_fallback"` or observation predates feature. UI must handle both states. |

### intent.llm_reasoning (NEW FIELD)

| Property | Value |
|----------|-------|
| Source of truth | `intent` table, `llm_reasoning` field (TYPE `option<string>`) |
| Owner | Intent authorization evaluation pipeline (`oauth/intent-submission.ts`) |
| Consumers | Intent detail UI, Audit provenance chain, Compliance review |
| Integration risk | **HIGH** -- must be clearly distinct from existing `intent.reasoning` (human rationale). Naming must prevent confusion. |
| Validation | Field populated when authorization used LLM evaluation. Field absent/NONE for policy-only evaluations (`evaluation.policy_only = true`). |

### intent.reasoning (EXISTING FIELD -- unchanged)

| Property | Value |
|----------|-------|
| Source of truth | `intent` table, `reasoning` field (TYPE `string`, required) |
| Owner | Intent requester (human or agent submitting intent) |
| Consumers | Intent detail UI, audit trail |
| Integration risk | **MEDIUM** -- existing consumers must not confuse this with new `llm_reasoning`. |
| Validation | Already required field. No change needed. |

### observation.source

| Property | Value |
|----------|-------|
| Source of truth | `observation` table, `source` field (TYPE `option<string>`) |
| Owner | Verification pipeline (`applyLlmVerdict()`) |
| Consumers | UI "View Logic" panel (determines panel content), Observer queries |
| Integration risk | **MEDIUM** -- UI uses this to decide whether to show LLM reasoning, deterministic fallback explanation, or "no reasoning" message. |
| Validation | Values: `"llm"`, `"deterministic_fallback"`, `"github"`, `"peer_review"`, `"none"`. When `"llm"`: reasoning field should be populated. When `"deterministic_fallback"`: reasoning field should be absent. |

### trace (EXISTING TABLE -- unchanged, used as link target)

| Property | Value |
|----------|-------|
| Source of truth | `trace` table |
| Owner | LLM call infrastructure |
| Consumers | Reasoning panel (model stats link), trace hierarchy navigation |
| Integration risk | **LOW** -- existing table, no schema changes. Used as link target from reasoning panel. |
| Validation | Trace must exist for LLM calls. Observation links to trace indirectly via `source_session -> invoked -> trace`. |

## Integration Validation Checklist

- [ ] `observation.reasoning` populated by `generateVerificationVerdict()` path in graph-scan.ts
- [ ] `observation.reasoning` populated by `generatePeerReviewVerdict()` path
- [ ] `observation.reasoning` populated by anomaly evaluation path in graph-scan.ts
- [ ] `observation.reasoning` populated by contradiction detection path
- [ ] `observation.reasoning` NOT populated when source is `deterministic_fallback`
- [ ] `intent.llm_reasoning` populated by authorization evaluation when LLM is used
- [ ] `intent.llm_reasoning` NOT populated when `evaluation.policy_only = true`
- [ ] UI "View Logic" panel reads `observation.reasoning` and handles NONE
- [ ] UI "View Logic" panel reads `observation.source` to determine panel content
- [ ] Observer self-calibration queries filter `WHERE reasoning != NONE`
- [ ] Non-admin API responses exclude `reasoning` field from observation payloads
- [ ] `intent.reasoning` (human) remains unchanged and distinct from `intent.llm_reasoning`
