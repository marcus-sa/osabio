# Extraction

LLM-powered entity inference from unstructured text — extracts decisions, tasks, features, relationships, and more from user messages and attachments.

## The Problem

Users communicate in natural language. They say "Let's use PostgreSQL for the user data" — that's a decision. They say "We need to add rate limiting before launch" — that's a task. The extraction pipeline turns unstructured conversation into structured graph nodes, so every message produces knowledge, not just chat history.

## What It Does

- **Structured extraction**: Uses LLM (Haiku) with a strict output schema to identify entities and relationships from text
- **3-tier deduplication**: Exact duplicate detection (>0.97 similarity), merge candidates (>=0.8), and new entity creation (<0.8)
- **Provenance tracking**: Every extracted entity links back to the source message with confidence scores
- **Embedding generation**: All extracted entities get vector embeddings for semantic search
- **Relationship extraction**: Identifies edges between entities (e.g. task `belongs_to` project, decision `conflicts_with` decision)

## Key Concepts

| Term | Definition |
|------|------------|
| **Extraction Schema** | Strict JSON schema sent to the LLM — defines entity types, fields, and relationships it can extract |
| **Confidence Score** | LLM's self-reported confidence in each extraction (0-1). Store threshold: 0.6, Display threshold: 0.85 |
| **Deduplication** | Three tiers: >0.97 = exact duplicate (reuse), >=0.8 = merge candidate (enrich), <0.8 = new entity |
| **Provenance** | `extracted_from` edge linking each entity to its source message with confidence and extraction metadata |
| **Normalization** | Post-extraction cleanup: status mapping, field validation, relationship resolution |

## How It Works

**Example — extracting from a chat message:**

1. User sends: "We decided to use tRPC instead of REST for internal APIs. @marcus to create the migration plan by Friday."
2. Extraction pipeline called with message text + conversation context
3. LLM returns structured output:
   - Decision: "Use tRPC for internal APIs" (confidence: 0.92, status: extracted)
   - Task: "Create tRPC migration plan" (confidence: 0.88, assignee: marcus, deadline: Friday)
   - Relationship: task `implements` decision
4. Deduplication check: embedding similarity against existing entities
   - Decision: no match >0.8 → create new
   - Task: existing "Plan API migration" at 0.85 similarity → merge candidate, enrich existing
5. Persist: entities created/updated in SurrealDB, `extracted_from` provenance edges created
6. Embeddings generated asynchronously for semantic search

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Low confidence (<0.6)** | Entity extracted but not persisted — below store threshold |
| **Ambiguous entity type** | LLM chooses best fit; confidence reflects uncertainty |
| **Duplicate detection** | Exact duplicates silently deduplicated; merge candidates flagged for review |
| **Attachment extraction** | Chunks processed separately, then merged with message extraction |
| **Missing relationships** | Entities created without edges; relationships added when endpoints are identified |

## Where It Fits

```text
User Message / Attachment
  |
  v
Extraction Pipeline (Haiku)
  |
  +---> Entity Extraction (structured schema)
  |       +-> decisions, tasks, features, projects, people
  |
  +---> Relationship Extraction
  |       +-> belongs_to, implements, conflicts_with, depends_on
  |
  +---> Deduplication (3-tier)
  |       +-> >0.97: reuse existing
  |       +-> >=0.8: merge/enrich
  |       +-> <0.8: create new
  |
  +---> Provenance
  |       +-> extracted_from edge with confidence
  |
  +---> Embedding Generation (async)
          +-> vector stored on entity for KNN search
```

**Consumes**: Raw message text, attachment chunks, conversation context
**Produces**: Graph entities, relationship edges, provenance links, embeddings

## File Structure

```text
extraction/
  schema.ts                # Extraction output schema (Zod) — defines entity types and fields
  prompt.ts                # LLM system prompt for extraction with examples
  types.ts                 # ExtractionResult, ExtractedEntity, ExtractedRelationship
  validation.ts            # Post-extraction validation and field normalization
  normalize.ts             # Status mapping, field cleanup, relationship resolution
  persist-extraction.ts    # Write extracted entities to SurrealDB with dedup
  provenance.ts            # Create extracted_from edges with confidence metadata
  roles.ts                 # Role-based extraction context (different prompts per actor type)
  embeddings.ts            # Async embedding generation for extracted entities
```
