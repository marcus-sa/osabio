# Descriptions

Dynamic entity description synthesis — accumulates structured entries over time and uses LLM to generate coherent paragraph summaries.

## The Problem

Knowledge graph entities (projects, tasks, decisions) accumulate information from multiple sources — user messages, agent observations, extraction results. Each source adds a fragment. Without synthesis, entity descriptions are either the first thing ever said about them (stale) or a raw dump of fragments (incoherent). Users need a single, up-to-date paragraph that captures the current understanding of an entity.

## What It Does

- **Entry accumulation**: Collects `DescriptionEntry` records from various sources (chat, extraction, agents)
- **LLM synthesis**: Generates coherent paragraph descriptions from accumulated entries
- **SurrealDB event triggers**: Automatically fires description regeneration when entries change
- **Persistence**: Stores both raw entries and synthesized descriptions for audit trail

## Key Concepts

| Term | Definition |
|------|------------|
| **DescriptionEntry** | A single fragment of information about an entity, from a specific source |
| **Synthesis** | LLM-generated coherent paragraph combining all entries for an entity |
| **Trigger** | SurrealDB `DEFINE EVENT` that fires description regeneration on entry changes |
| **Source Attribution** | Each entry tracks its origin (chat message, extraction, agent observation) |

## How It Works

1. User says "The auth service handles OAuth 2.1 with PKCE"
2. Extraction pipeline creates a `DescriptionEntry` for the `auth-service` entity
3. Later, an agent logs "Auth service also supports DPoP token binding"
4. Another `DescriptionEntry` is added
5. SurrealDB event trigger fires → LLM synthesizes entries into: "The auth service implements OAuth 2.1 with PKCE for authorization code flows and DPoP for sender-constrained token binding."
6. Synthesized description stored on the entity record

## Where It Fits

```text
Sources (chat, extraction, agents)
  |
  v
DescriptionEntry records (accumulated over time)
  |
  v
SurrealDB EVENT trigger (on entry change)
  |
  v
LLM Synthesis (generate coherent paragraph)
  |
  v
Entity.description (updated, single source of truth)
```

**Consumes**: Raw information fragments from chat, extraction pipeline, and agent observations
**Produces**: Synthesized entity descriptions stored on graph nodes

## File Structure

```text
descriptions/
  generate.ts    # LLM synthesis — generates paragraph from DescriptionEntry array
  persist.ts     # Persistence layer for entries and synthesized descriptions
  queries.ts     # SurrealDB CRUD for DescriptionEntry records
  triggers.ts    # SurrealDB EVENT definitions for auto-regeneration
  types.ts       # DescriptionEntry, SynthesisResult type definitions
```
