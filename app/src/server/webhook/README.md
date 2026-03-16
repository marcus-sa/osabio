# Webhook

GitHub webhook processing — extracts entities from commit messages, links decisions to code, and updates task status from push events.

## The Problem

Code commits carry domain knowledge. A commit message says "Implement token bucket rate limiter per decision #42." That's a link between code and a graph decision. Another commit says "Fix #123: resolve race condition in auth middleware." That's a task status update. Without webhook processing, this knowledge stays locked in git logs, invisible to the knowledge graph.

## What It Does

- **GitHub push webhook**: Validates HMAC-SHA256 signatures, processes commit payloads
- **Entity extraction from commits**: LLM extracts decisions, observations, and relationships from commit messages
- **Auto-linking**: High-confidence extractions (>= 0.85) automatically linked to existing graph entities
- **Task reference parsing**: Extracts `task:abc123` or `#123` references from commit messages
- **Task status updates**: Keywords in commits trigger status transitions (e.g. "fix", "close", "resolve" → done)
- **Fire-and-forget**: Returns 202 immediately, processes asynchronously

## Key Concepts

| Term | Definition |
|------|------------|
| **Webhook Signature** | HMAC-SHA256 of payload with shared secret — validates GitHub is the sender |
| **Commit Processor** | Orchestrates per-commit: extract entities → classify confidence → link or observe |
| **Auto-Link Threshold** | 0.85 confidence — above this, extracted decisions are automatically linked to graph entities |
| **Task Reference** | `task:abc123` or `tasks: abc, def` in commit messages — parsed by regex |
| **Status Keyword** | Words like "fix", "close", "resolve", "complete" trigger task → `done` transition |

## How It Works

**Example — processing a push event:**

1. GitHub sends `POST /api/webhooks/github` with push payload
2. Validate HMAC-SHA256 signature → return 202 immediately
3. Async processing per commit:
   - Extract entities from commit message via LLM
   - Decision extracted with confidence 0.91 → auto-link to existing graph decision
   - Decision extracted with confidence 0.72 → create observation (risk, not auto-linked)
   - Parse task references: `task:abc123` found
   - Keyword "fix" detected → transition task abc123 to `done`
4. Observations created for lower-confidence findings

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Invalid signature** | 401 — reject immediately, no processing |
| **Merge commits** | Processed like regular commits — extraction runs on message |
| **No task reference** | Commit processed for entity extraction only |
| **Multiple task refs** | Each reference processed independently |
| **LLM extraction fails** | Logged, commit skipped — other commits still processed |

## Where It Fits

```text
GitHub Push Event
  |
  v
POST /api/webhooks/github
  +---> Validate HMAC-SHA256 signature
  +---> Return 202 (fire-and-forget)
  |
  v (async)
Per-Commit Processing
  +---> LLM Entity Extraction
  |       +-> confidence >= 0.85: auto-link to graph
  |       +-> confidence < 0.85: create observation
  |
  +---> Task Reference Parsing
  |       +-> regex: task:xxx, #123
  |
  +---> Status Keyword Detection
          +-> "fix", "close", "resolve" -> task done
```

**Consumes**: GitHub push webhook payloads, HMAC secret
**Produces**: Extracted entities, graph links, task status updates, observations

## File Structure

```text
webhook/
  github-webhook-route.ts      # Webhook handler + HMAC-SHA256 signature verification
  github-commit-processor.ts   # Per-commit orchestrator: extract, classify, link/observe
  commit-task-refs.ts          # Regex extraction of task:xxx references from commit messages
  task-status-from-push.ts     # Keyword-based task status transitions (fix/close -> done)
  types.ts                     # GitHub webhook event type definitions
```
