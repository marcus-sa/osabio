export const ANALYTICS_FEW_SHOT_EXAMPLES = `
## Example Queries

### 1. Basic aggregation: count open tasks
\`\`\`sql
SELECT count() AS total
FROM task
WHERE status = 'open'
GROUP ALL
LIMIT 1;
\`\`\`

### 2. Group by aggregation: tasks per status
\`\`\`sql
SELECT status, count() AS total
FROM task
GROUP BY status
ORDER BY total DESC
LIMIT 20;
\`\`\`

### 3. Forward graph traversal: which project does a task belong to
\`\`\`sql
SELECT id, title, ->belongs_to->project.{name, status} AS projects
FROM task
WHERE id = $target
LIMIT 1;
\`\`\`

### 4. Reverse graph traversal: all tasks belonging to a project
\`\`\`sql
SELECT id, title, status
FROM task
WHERE ->belongs_to->project CONTAINS $project
ORDER BY created_at DESC
LIMIT 50;
\`\`\`

### 5. Time comparison: stale provisional decisions (older than 2 weeks)
\`\`\`sql
SELECT id, summary, status, created_at
FROM decision
WHERE status = 'provisional'
  AND created_at < time::now() - 2w
ORDER BY created_at ASC
LIMIT 50;
\`\`\`

### 6. Multi-hop traversal: features and their tasks for a project
\`\`\`sql
SELECT name, status, <-has_feature<-project.name AS project_names,
  <-has_task<-task.{title, status} AS tasks
FROM feature
LIMIT 50;
\`\`\`

### 7. Provenance: why does this entity exist (extraction source)
\`\`\`sql
SELECT <-extraction_relation<-message.{text, role, createdAt} AS source_messages,
  <-extraction_relation.{confidence, model, evidence} AS extraction_info
FROM $target
LIMIT 10;
\`\`\`

### 8. Cross-entity pattern: entities appearing in multiple projects
\`\`\`sql
SELECT id, record::table(id) AS entity_type, ->belongs_to->project AS projects
FROM task, decision, question
WHERE array::len(->belongs_to->project) > 1
LIMIT 50;
\`\`\`

### 9. Observation detail: list open observations with text
\`\`\`sql
SELECT id, text, severity, status, created_at
FROM observation
WHERE status = 'open'
ORDER BY created_at DESC
LIMIT 50;
\`\`\`

### 10. Relation table traversal: query edges directly (no JOINs or aliases)
SurrealQL has no JOIN or table aliases. Query relation tables directly and use \`in\`/\`out\` fields:
\`\`\`sql
SELECT *, in AS from_entity, out AS to_entity
FROM conflicts_with
LIMIT 50;
\`\`\`

### 11. Dependency chains: tasks with dependencies
\`\`\`sql
SELECT id, title, status,
  ->depends_on->task.{id, title, status} AS depends_on
FROM task
WHERE ->depends_on->task IS NOT NONE
LIMIT 50;
\`\`\`
`;
