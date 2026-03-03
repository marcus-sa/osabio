export const SURREALQL_SYNTAX_REFERENCE = `
## SurrealQL Syntax Reference

### SELECT Statement
\`\`\`
SELECT [ VALUE ] @fields [ AS @alias ] [ OMIT @fields ]
  FROM [ ONLY ] @targets
  [ WHERE @conditions ]
  [ SPLIT [ ON ] @field, ... ]
  [ GROUP [ BY ] @field, ... ]
  [ ORDER [ BY ] @field [ COLLATE ] [ NUMERIC ] [ ASC | DESC ], ... | RAND() ]
  [ LIMIT @number [ START @start ] ]
  [ FETCH @fields ... ]
;
\`\`\`

### Graph Traversal (Arrow Syntax)
SurrealDB uses arrow syntax for graph traversal — NOT SQL JOINs.

- Forward traversal: \`->edge_table->target_table\`
- Reverse traversal: \`<-edge_table<-source_table\`
- Bidirectional: \`<->edge_table<->table\`
- Projections on traversal: \`->edge->table.{field1, field2}\`
- Multi-hop: \`->edge1->table1->edge2->table2\`

Examples:
\`\`\`sql
-- Tasks belonging to a feature
SELECT <-has_task<-task FROM feature;

-- Projects in a workspace
SELECT ->has_project->project FROM workspace;

-- Multi-hop: tasks in projects of a workspace
SELECT ->has_project->project->has_feature->feature->has_task->task FROM workspace;

-- Dependency chain traversal
SELECT ->depends_on->task.{title, status} FROM task;

-- Observations linked to a project
SELECT <-observes<-observation FROM project;

-- Filter on graph edge properties
SELECT * FROM task WHERE ->depends_on[WHERE type = 'blocks']->task;
\`\`\`

### Time Literals & Functions
Use duration literals — NOT SQL INTERVAL syntax.

Duration literals: \`1s\`, \`5m\`, \`2h\`, \`1d\`, \`1w\`, \`2w\`, \`30d\`

\`\`\`sql
-- Correct: duration literal
WHERE created_at < time::now() - 2w

-- WRONG: SQL INTERVAL (does NOT exist in SurrealQL)
-- WHERE created_at < NOW() - INTERVAL '2 weeks'
\`\`\`

Time functions:
- \`time::now()\` — current datetime
- \`time::floor(datetime, duration)\` — round down
- \`time::day(datetime)\`, \`time::month(datetime)\`, \`time::year(datetime)\`

### GROUP BY / GROUP ALL
Every non-aggregate field in the SELECT projection must appear in the GROUP BY clause. Use \`GROUP ALL\` to aggregate the entire table into a single row.

\`\`\`sql
-- Count tasks by status
SELECT status, count() AS total FROM task GROUP BY status;

-- Count tasks by status and priority
SELECT status, priority, count() AS total FROM task GROUP BY status, priority;

-- Total count across entire table
SELECT count() AS total FROM task GROUP ALL;

-- Collect unique values from arrays across all records
SELECT array::group(options_considered) AS all_options FROM decision GROUP ALL;
\`\`\`

**SPLIT and GROUP BY are incompatible** — they cannot be used together (parsing error since v3.0.0).

### Aggregate Functions
- \`count()\` — count rows in group
- \`math::sum(expr)\` — sum values
- \`math::mean(expr)\` — average
- \`math::min(expr)\`, \`math::max(expr)\`
- \`array::len(array)\` — array length

### Useful Built-in Functions
- \`record::table(id)\` — get table name from a record ID
- \`record::id(id)\` — get the ID portion of a record ID
- \`array::flatten(array)\` — flatten nested arrays
- \`array::distinct(array)\` — unique values
- \`array::group(array)\` — collect arrays across groups
- \`array::len(array)\` — array length
- \`string::lowercase(str)\`, \`string::contains(str, substr)\`
- \`type::is::record(value)\` — check if value is a record

### Operators
Comparison: \`=\` (or \`IS\`), \`!=\` (or \`IS NOT\`), \`==\` (exact type-checked), \`<\`, \`<=\`, \`>\`, \`>=\`
Logic: \`AND\` (or \`&&\`), \`OR\` (or \`||\`), \`!\` (negate)
Membership: \`IN\` (value in array/string), \`NOT IN\`, \`CONTAINS\` (array/string contains value), \`CONTAINSALL\`, \`CONTAINSANY\`
Coalescing: \`??\` (null coalescing — first non-NONE value), \`?:\` (truthy coalescing — first truthy value)
Arithmetic: \`+\`, \`-\` (used with duration literals for time math)

\`\`\`sql
-- Null coalescing: fallback for optional fields
SELECT title, priority ?? 'unset' AS priority FROM task;

-- Truthy coalescing: fallback for empty strings
SELECT owner_name ?: 'unassigned' AS owner FROM task;

-- Array membership
SELECT * FROM decision WHERE status IN ['provisional', 'extracted'];

-- Array contains check
SELECT * FROM decision WHERE options_considered CONTAINS 'PostgreSQL';
\`\`\`

### WHERE Clause
Supports boolean logic, graph edge conditions, and field presence checks.

\`\`\`sql
-- Boolean logic
SELECT * FROM task WHERE status = 'open' AND priority = 'high';

-- Filter based on graph edge count
SELECT * FROM project WHERE count(->has_feature->feature) > 3;

-- IS NOT NONE for optional field presence
SELECT * FROM task WHERE deadline IS NOT NONE;

-- Truthy check (present and not empty)
SELECT * FROM task WHERE owner_name;

-- Multiple status values
SELECT * FROM decision WHERE status IN ['provisional', 'extracted'];
\`\`\`

### FETCH Clause
FETCH resolves record links into full objects. Without FETCH, record references are returned as IDs.

\`\`\`sql
-- Resolve owner record link to full person object
SELECT title, status, owner FROM task FETCH owner;

-- Resolve workspace on observations
SELECT text, severity, workspace FROM observation FETCH workspace;
\`\`\`

### LET Variables
Use LET to store intermediate results and reuse them across statements.

\`\`\`sql
LET $cutoff = time::now() - 2w;
SELECT * FROM decision WHERE created_at < $cutoff AND status = 'provisional' LIMIT 100;
\`\`\`

### IF ELSE
Can be used as a standalone statement or inline within SELECT to compute fields.

\`\`\`sql
-- Inline: computed field
SELECT title,
  IF status = 'open' { 'active' }
  ELSE IF status = 'blocked' { 'at risk' }
  ELSE { 'done' }
  AS health
FROM task;
\`\`\`

### RETURN Statement
RETURN returns an implicit value or query result. Use it to compose multi-query results.

\`\`\`sql
LET $open = (SELECT count() AS total FROM task WHERE status = 'open' GROUP ALL);
LET $blocked = (SELECT count() AS total FROM task WHERE status = 'blocked' GROUP ALL);
RETURN { open: $open[0].total, blocked: $blocked[0].total };
\`\`\`

### Important Rules
1. Always include a \`LIMIT\` clause (default to 100 if not specified by user intent)
2. ORDER BY fields must appear in the SELECT projection
3. LIMIT must come before FETCH
4. Use \`$param\` syntax for parameterized values
5. For TYPE RELATION tables, edges have \`in\` and \`out\` fields
6. \`IS NOT NONE\` checks for field existence (not \`IS NOT NULL\`)
7. This agent is read-only — only SELECT queries are permitted

### DO NOT USE (SQL constructs that do NOT exist in SurrealQL)
- \`JOIN\` — use arrow traversal instead
- \`INTERVAL\` — use duration literals (2w, 1d, etc.)
- \`HAVING\` — use WHERE with GROUP BY
- \`COALESCE\` / \`IFNULL\` — use \`??\` (null coalescing) or \`?:\` (truthy coalescing) instead
- Subqueries in SELECT list — use LET variables instead
- \`LIMIT N OFFSET M\` — use \`LIMIT @number START @start\` instead
- \`AS\` for table aliases — not supported
- \`UNION\` / \`INTERSECT\` — use array functions or multiple queries
- \`EXISTS()\` — not a function in SurrealQL. Use \`IS NOT NONE\` for field presence checks
- \`LIKE\` — not supported. Use \`string::starts_with()\`, \`string::contains()\`, or \`~\` (regex) instead
- \`string::startswith\` — wrong name. The correct function is \`string::starts_with\` (with underscore)
`;
