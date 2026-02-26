# 03 - Extraction and Search

## Objective
Extract `task`, `decision`, and `question` entities and expose searchable results.

## Deliverables
- Deterministic keyword extraction with confidence scores.
- Assistant message persistence with extracted entities.
- Search endpoint returns typed entity rows by query.

## Acceptance Criteria
- Seed messages with explicit signals create expected entity kinds.
- Search endpoint returns rows with no null values.
