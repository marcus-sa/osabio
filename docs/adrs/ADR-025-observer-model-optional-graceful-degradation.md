# ADR-025: Observer Model Optional with Graceful Degradation

## Status

Accepted

## Context

The observer pipeline must work in environments where no LLM is configured (e.g., local development, CI, self-hosted instances without API keys). The existing observer is fully deterministic and should remain functional without LLM.

We need a configuration pattern that enables LLM reasoning when available and degrades gracefully when not.

## Decision

`OBSERVER_MODEL` is an optional environment variable. When unset or empty:
- Observer operates in deterministic-only mode (current behavior)
- Zero LLM API calls are made
- No error is raised at startup

When set:
- Observer model client is created using the existing OpenRouter/Ollama provider abstraction
- LLM reasoning is available to verification and synthesis pipelines
- The model is added to `ServerDependencies` as `observerModel?: LanguageModel`

This follows the existing pattern where `PM_AGENT_MODEL` defaults to `extractionModelId` when unset, but goes further: the observer model has no fallback — it is either explicitly configured or LLM reasoning is off.

## Alternatives Considered

### Alternative 1: Reuse extraction model as default
- **What**: When `OBSERVER_MODEL` unset, use `EXTRACTION_MODEL`
- **Expected impact**: LLM reasoning always available when extraction works
- **Why rejected**: Extraction model may be tuned for entity extraction prompts. Observer reasoning has different requirements (semantic comparison, synthesis). Implicit model sharing creates surprise cost and may produce suboptimal results. Explicit opt-in is safer.

### Alternative 2: Require OBSERVER_MODEL for server startup
- **What**: Make it a required env var
- **Expected impact**: Simpler code — no conditional LLM paths
- **Why rejected**: Breaks existing deployments. Observer was deterministic-only until now. Requiring a new env var is a breaking change for all environments. Optional with graceful degradation preserves backwards compatibility.

## Consequences

### Positive
- Zero breaking changes for existing deployments
- Clear opt-in: set `OBSERVER_MODEL` to enable LLM reasoning
- DevOps can control cost per environment (production: LLM on, CI: LLM off)
- Deterministic pipeline remains the tested, reliable baseline

### Negative
- Conditional LLM paths add branching in verification/synthesis code
- Need to test both paths (LLM enabled and disabled) in acceptance tests
