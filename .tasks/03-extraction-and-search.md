# 03 - Extraction and Search

## Objective
Extract `task`, `decision`, and `question` entities and expose searchable results.

## Deliverables
- Vercel AI extraction prompt with context (`ai` + `@ai-sdk/openai`) returning structured JSON.
- Confidence filtering using configured threshold before persistence.
- SurrealDB transactional persistence for assistant message, entities, and extracted relationships.
- Search endpoint returns typed entity rows by query from SurrealDB.

## Acceptance Criteria
- Seed messages with explicit signals create expected entity kinds.
- Extraction output includes both entities and relationships at/above threshold.
- Search endpoint returns rows with no null values.
